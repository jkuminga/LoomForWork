import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database as BunDatabase } from "bun:sqlite";

import { SQLiteBackend } from "../../../vendor/memory-graph/ts/src/backends/sqlite.ts";
import {
  createMemory,
  createRelationshipProperties,
  SearchQuerySchema,
} from "../../../vendor/memory-graph/ts/src/models.ts";

import type {
  InspectKeywordSearcher,
  InspectSourceMemory,
  FinalizeMemoryClient,
  FinalizeStoredMemory,
  KeywordSearcher,
  RecallSourceMemory,
} from "./types.ts";

export const MEMORY_DATABASE_RELATIVE_PATH = "harness-data/memorygraph.db";
export const MEMORY_SCHEMA_VERSION = 1;

/** Find the enclosing Git repository without invoking a shell command. */
export function findProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function toFinalizeMemory(memory: Awaited<ReturnType<SQLiteBackend["getMemory"]>>): FinalizeStoredMemory | null {
  if (!memory?.id) return null;
  return {
    id: memory.id,
    type: memory.type,
    title: memory.title,
    content: memory.content,
    summary: memory.summary,
    tags: memory.tags,
    importance: memory.importance,
    confidence: memory.confidence,
    context: memory.context as Record<string, unknown> | null | undefined,
  };
}

/** Resolve the MemoryGraph SQLite file shared by this repository's worktrees. */
export function resolveMemoryDatabasePath(projectRoot: string): string {
  const override = process.env.HARNESS_MEMORY_DB_PATH?.trim();
  if (override) return override;
  const commonDirectory = execFileSync(
    "git", ["-C", projectRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  if (!commonDirectory) throw new Error("git_common_directory_not_found");
  const databasePath = join(commonDirectory, MEMORY_DATABASE_RELATIVE_PATH);
  if (!existsSync(databasePath)) {
    const worktrees = execFileSync("git", ["-C", projectRoot, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    for (const line of worktrees.split("\n")) {
      if (line.startsWith("worktree ") && existsSync(join(line.slice(9), ".harness/memorygraph.db"))) {
        throw new Error("shared memorygraph.db is missing; migrate the worktree database first");
      }
    }
  }
  return databasePath;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function compactSummary(summary: string | null | undefined, content: string): string {
  const value = summary?.trim() || content.trim();
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

async function withoutInfoLogs<T>(operation: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    return await operation();
  } finally {
    console.log = originalLog;
  }
}

async function openMemoryBackendOnce(databasePath: string): Promise<SQLiteBackend> {
  if (existsSync(databasePath)) {
    const preflight = new BunDatabase(databasePath, { readonly: true, create: false });
    try {
      const version = preflight.query("PRAGMA user_version").get() as { user_version: number };
      const schema = preflight.query("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get();
      if (schema && version.user_version !== MEMORY_SCHEMA_VERSION) {
        throw new Error(`memorygraph.db schema version ${version.user_version} differs from supported version ${MEMORY_SCHEMA_VERSION}`);
      }
    } finally {
      preflight.close();
    }
  }
  const backend = new SQLiteBackend(databasePath);
  try {
    await withoutInfoLogs(async () => {
      await backend.connect();
      await backend.initializeSchema();
      backend.db!.exec(`PRAGMA user_version = ${MEMORY_SCHEMA_VERSION}`);
    });
    return backend;
  } catch (error) {
    try {
      await withoutInfoLogs(() => backend.disconnect());
    } catch {
      // Keep the original connection or schema error.
    }
    throw error;
  }
}

async function openMemoryBackend(databasePath: string): Promise<SQLiteBackend> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await openMemoryBackendOnce(databasePath);
    } catch (error) {
      if (attempt >= 7 || !String(error).includes("database is locked")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

/**
 * Open one MemoryGraph SQLite connection and expose only the keyword-search
 * function required by the wrapper. The returned close function must run.
 */
export async function openMemorySearchClient(databasePath: string): Promise<{
  searchKeyword: KeywordSearcher;
  close: () => Promise<void>;
}> {
  const backend = await openMemoryBackend(databasePath);

  const searchKeyword: KeywordSearcher = async (keyword, limit) => {
    const query = SearchQuerySchema.parse({
      query: keyword,
      limit,
      include_relationships: false,
    });
    const memories = await backend.searchMemories(query);

    return memories
      .filter((memory) => Boolean(memory.id))
      .map<RecallSourceMemory>((memory) => ({
        id: memory.id as string,
        title: memory.title,
        summary: compactSummary(memory.summary, memory.content),
        importance: memory.importance,
        updatedAt: toIsoString(memory.updated_at),
      }));
  };

  return {
    searchKeyword,
    close: () => withoutInfoLogs(() => backend.disconnect()),
  };
}

/** Open the richer read-only search boundary used to inspect one Candidate. */
export async function openMemoryInspectClient(databasePath: string): Promise<{
  searchKeyword: InspectKeywordSearcher;
  close: () => Promise<void>;
}> {
  const backend = await openMemoryBackend(databasePath);

  const searchKeyword: InspectKeywordSearcher = async (keyword, limit) => {
    const query = SearchQuerySchema.parse({
      query: keyword,
      limit,
      include_relationships: false,
    });
    const memories = await backend.searchMemories(query);

    return memories
      .filter((memory) => Boolean(memory.id))
      .map<InspectSourceMemory>((memory) => ({
        id: memory.id as string,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        summary: compactSummary(memory.summary, memory.content),
        tags: memory.tags,
        importance: memory.importance,
        confidence: memory.confidence,
        updatedAt: toIsoString(memory.updated_at),
      }));
  };

  return {
    searchKeyword,
    close: () => withoutInfoLogs(() => backend.disconnect()),
  };
}

/** Open the narrow write boundary used by Candidate finalization. */
export async function openMemoryFinalizeClient(databasePath: string): Promise<{
  client: FinalizeMemoryClient;
  close: () => Promise<void>;
}> {
  const backend = await openMemoryBackend(databasePath);
  const client: FinalizeMemoryClient = {
    getMemory: async (id) => toFinalizeMemory(await backend.getMemory(id, false)),
    createMemory: async (memory) => {
      await withoutInfoLogs(() => backend.storeMemory(createMemory({
        ...memory,
        context: memory.context ?? undefined,
      })));
    },
    updateMemory: async (memory) => {
      const current = await backend.getMemory(memory.id, false);
      if (!current) throw new Error("memory_not_found");
      const currentContext = (current.context ?? {}) as Record<string, unknown>;
      const incomingContext = (memory.context ?? {}) as Record<string, unknown>;
      const currentMetadata = (currentContext.additional_metadata ?? {}) as Record<string, unknown>;
      const incomingMetadata = (incomingContext.additional_metadata ?? {}) as Record<string, unknown>;
      await backend.updateMemory(createMemory({
        ...current,
        ...memory,
        context: {
          ...currentContext,
          ...incomingContext,
          additional_metadata: { ...currentMetadata, ...incomingMetadata },
        },
        version: current.version + 1,
        updated_by: "lfw",
      }));
    },
    relationshipExists: async (fromId, toId, type) => {
      const related = await backend.getRelatedMemories(fromId, {
        relationshipTypes: [type], maxDepth: 1,
      });
      return related.some(([, relation]) =>
        relation.from_memory_id === fromId
        && relation.to_memory_id === toId
        && relation.type === type);
    },
    createRelationship: async (fromId, toId, type, properties) => {
      await withoutInfoLogs(() => backend.createRelationship(
        fromId, toId, type, createRelationshipProperties(properties),
      ));
    },
  };
  return { client, close: () => withoutInfoLogs(() => backend.disconnect()) };
}

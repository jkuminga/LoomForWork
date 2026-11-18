import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openMemoryFinalizeClient } from "../../src/harness/memory/client.ts";
import { SQLiteBackend } from "../../codex-compass/vendor/memory-graph/ts/src/backends/sqlite.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retries a locked MemoryGraph connection and then succeeds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harness-memory-lock-retry-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "memorygraph.db");
  const originalConnect = SQLiteBackend.prototype.connect;
  let attempts = 0;
  const connect = spyOn(SQLiteBackend.prototype, "connect").mockImplementation(async function (this: SQLiteBackend) {
    attempts++;
    if (attempts === 1) throw new Error("database is locked");
    return originalConnect.call(this);
  });

  try {
    const connection = await openMemoryFinalizeClient(databasePath);
    try {
      expect(attempts).toBe(2);
      expect(connection.client.getMemory).toBeFunction();
    } finally {
      await connection.close();
    }
  } finally {
    connect.mockRestore();
  }
});

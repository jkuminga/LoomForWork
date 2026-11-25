#!/usr/bin/env bun
/** Install the packaged Harness into the current Git project. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type InstallRecord = {
  format_version: 1;
  harness_version: string;
  integrations: string[];
  managed_files: Record<string, string>;
  installed_skills: Record<string, string>;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(process.cwd());
const harnessSource = join(packageRoot, "lfw");
const harnessTarget = join(projectRoot, "lfw");
const recordPath = join(harnessTarget, "install.json");
const requiredSkills = ["work-start", "work-finish", "memory-finalize", "work-item-create", "mvp-to-prd", "verify-prd", "extract-features"];
const integrations = ["AGENTS.md", ".gitignore", ".codex/config.toml", ".codex/hooks.json", "package.json"];
const projectScripts = {
  console: "lfw/bin/harness-control-center",
  "verify:install": "lfw/bin/harness-verify-install",
  "worktree:setup": "lfw/bin/harness-configure-worktree",
};
const excludedNames = new Set([".DS_Store", ".venv", "node_modules", "__pycache__", "runtime", "install.json"]);

function fail(message: string): never { throw new Error(message); }
function read(path: string): string { return readFileSync(path, "utf8"); }
function json(path: string): any { return JSON.parse(read(path)); }
function run(program: string, args: string[], cwd = projectRoot): string {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) fail(`${program} ${args.join(" ")} 실패: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}
function hash(path: string): string { return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`; }
function files(root: string): string[] {
  const result: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excludedNames.has(entry.name) || entry.name.endsWith(".pyc")) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`심볼릭 링크는 배포 파일로 사용할 수 없습니다: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(relative(root, path));
    }
  }
  visit(root);
  return result.sort();
}
function directoryHash(root: string): string {
  const digest = createHash("sha256");
  for (const path of files(root)) {
    digest.update(path).update("\0").update(readFileSync(join(root, path))).update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}
function userFiles(root: string): string[] {
  const result: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".venv" || entry.name === "node_modules" || entry.name === "__pycache__") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(relative(root, path));
    }
  }
  visit(root);
  return result;
}
function checkPrerequisites(): void {
  if (process.platform !== "darwin") fail("첫 배포는 macOS만 지원합니다.");
  for (const command of ["git", "bun", "uv", "fzf", "python3"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status !== 0) fail(`${command} 명령이 필요합니다.${command === "fzf" ? " brew install fzf" : ""}`);
  }
  const pythonVersion = run("python3", ["-c", "import sys; print(sys.version_info.major, sys.version_info.minor)"])
    .split(" ").map(Number);
  if (pythonVersion[0] < 3 || (pythonVersion[0] === 3 && pythonVersion[1] < 10)) fail("Python 3.10 이상이 필요합니다.");
}
function gitCommonDirectory(): string {
  const root = run("git", ["rev-parse", "--show-toplevel"]);
  if (resolve(root) !== projectRoot) fail(`대상은 Git 저장소 루트여야 합니다: ${root}`);
  return run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
}
function parseRecord(): InstallRecord | null {
  if (!existsSync(recordPath)) return null;
  const record = json(recordPath) as InstallRecord;
  if (record.format_version !== 1 || typeof record.harness_version !== "string" ||
      !record.managed_files || !record.installed_skills || !Array.isArray(record.integrations)) {
    fail(`설치 기록 형식이 잘못되었습니다: ${recordPath}`);
  }
  return record;
}
function version(): string { return String(json(join(packageRoot, "package.json")).version); }
function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeMarked(original: string, content: string, start: string, end: string, path: string): string {
  if (original.includes(start) || original.includes(end)) fail(`이미 하네스 표시 구획이 있습니다: ${path}`);
  return `${start}\n${content.trimEnd()}\n${end}\n${original ? `\n${original}` : ""}`;
}
function mergeHooks(original: string): string {
  const result = original.trim() ? JSON.parse(original) : {};
  if (!isObject(result)) fail(".codex/hooks.json 최상위 값은 객체여야 합니다.");
  if (result.hooks === undefined) result.hooks = {};
  if (!isObject(result.hooks)) fail(".codex/hooks.json의 hooks는 객체여야 합니다.");
  const source = json(join(packageRoot, "installer/templates/hooks.json"));
  for (const [event, entries] of Object.entries(source.hooks) as [string, any[]][]) {
    if (result.hooks[event] === undefined) result.hooks[event] = [];
    const existing = result.hooks[event];
    if (!Array.isArray(existing) || existing.some((item: unknown) => !isObject(item) || !Array.isArray(item.hooks))) {
      fail(`.codex/hooks.json의 ${event} 항목 형식이 잘못되었습니다.`);
    }
    const command = entries[0].hooks[0].command;
    if (!existing.some((item: any) => item.hooks.some((hook: any) => hook?.command === command))) {
      existing.unshift(entries[0]);
    }
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}
function mergeConfig(original: string): string {
  let parsed: any;
  try { parsed = original.trim() ? Bun.TOML.parse(original) : {}; }
  catch (error) { fail(`.codex/config.toml 형식이 잘못되었습니다: ${error}`); }
  if (parsed?.mcp_servers?.["harness-state"] || parsed?.mcp_servers?.["harness-memory"]) {
    fail(".codex/config.toml에 harness-state 또는 harness-memory 서버가 이미 있습니다.");
  }
  const cwd = JSON.stringify(harnessTarget);
  const template = read(join(packageRoot, "installer/templates/config.toml"))
    .replaceAll('"__LFW_CWD__"', cwd);
  const merged = `${original.trimEnd()}${original.trim() ? "\n\n" : ""}${template}`;
  Bun.TOML.parse(merged);
  return merged;
}
function mergePackage(original: string): string {
  let parsed: any;
  try { parsed = original.trim() ? JSON.parse(original) : {}; }
  catch (error) { fail(`package.json 형식이 잘못되었습니다: ${error}`); }
  if (!isObject(parsed)) fail("package.json 최상위 값은 객체여야 합니다.");
  if (parsed.scripts === undefined) parsed.scripts = {};
  if (!isObject(parsed.scripts)) fail("package.json의 scripts는 객체여야 합니다.");
  for (const [name, command] of Object.entries(projectScripts)) {
    if (parsed.scripts[name] !== undefined && parsed.scripts[name] !== command) {
      fail(`package.json에 이미 다른 ${name} 스크립트가 있습니다.`);
    }
    parsed.scripts[name] = command;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
function sharedFiles(): Map<string, string> {
  const result = new Map<string, string>();
  const agents = join(projectRoot, "AGENTS.md");
  const ignore = join(projectRoot, ".gitignore");
  const hooks = join(projectRoot, ".codex/hooks.json");
  const config = join(projectRoot, ".codex/config.toml");
  result.set(agents, mergeMarked(existsSync(agents) ? read(agents) : "", read(join(packageRoot, "AGENTS.md")),
    "<!-- lfw:start -->", "<!-- lfw:end -->", agents));
  const ignoreTemplate = read(join(packageRoot, "installer/templates/gitignore"));
  const [start, ...rest] = ignoreTemplate.trimEnd().split("\n");
  const end = rest.pop()!;
  result.set(ignore, mergeMarked(existsSync(ignore) ? read(ignore) : "", rest.join("\n"), start, end, ignore));
  result.set(hooks, mergeHooks(existsSync(hooks) ? read(hooks) : ""));
  result.set(config, mergeConfig(existsSync(config) ? read(config) : ""));
  const packageFile = join(projectRoot, "package.json");
  result.set(packageFile, mergePackage(existsSync(packageFile) ? read(packageFile) : ""));
  return result;
}
function copySource(destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const path of files(harnessSource)) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(harnessSource, path), target, { preserveTimestamps: true });
  }
}
function prepareDependencies(stagedHarness: string): void {
  run("uv", ["sync", "--locked", "--no-dev"], stagedHarness);
  run("bun", ["install", "--frozen-lockfile"], join(stagedHarness, "vendor/memory-graph/ts"));
}
function initializeDatabases(common: string): void {
  const data = join(common, "harness-data");
  run("uv", ["run", "--no-sync", "python", "-c",
    "from src.harness import state_store; state_store.initialize_database(state_store.DEFAULT_DATABASE_PATH)"], harnessTarget);
  run("bun", ["run", "src/harness/memory/cli.ts", "recall", "installation verification"], harnessTarget);
  for (const path of [join(data, "state.db"), join(data, "memorygraph.db")]) {
    if (!existsSync(path) || statSync(path).size === 0) fail(`공유 DB 검증 실패: ${path}`);
  }
}
function recordForCurrent(versionValue: string): InstallRecord {
  const managed_files: Record<string, string> = {};
  for (const path of files(harnessSource)) managed_files[path] = hash(join(harnessTarget, path));
  const installed_skills: Record<string, string> = {};
  for (const skill of requiredSkills) installed_skills[skill] = directoryHash(join(projectRoot, ".agents/skills", skill));
  return { format_version: 1, harness_version: versionValue, integrations, managed_files, installed_skills };
}
function install(): void {
  const current = parseRecord();
  const nextVersion = version();
  if (current) {
    if (current.harness_version === nextVersion) { console.log(`하네스 ${nextVersion}이 이미 설치되어 있습니다.`); return; }
    console.log(`설치 버전 ${current.harness_version}, 패키지 버전 ${nextVersion}. 업데이트하려면 bunx loomforwork@latest update를 실행하세요.`);
    return;
  }
  checkPrerequisites();
  if (existsSync(harnessTarget)) fail(`설치 대상이 이미 있습니다: ${harnessTarget}`);
  for (const skill of requiredSkills) {
    if (existsSync(join(projectRoot, ".agents/skills", skill))) fail(`스킬 이름 충돌: ${skill}`);
  }
  const shared = sharedFiles();
  const rootExists = existsSync(join(projectRoot, ".git"));
  if (!rootExists && spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot, stdio: "ignore" }).status === 0) {
    fail("상위 Git 저장소 안에서는 설치할 수 없습니다. 대상 프로젝트 루트에 설치하세요.");
  }
  if (rootExists) gitCommonDirectory();
  const stage = mkdtempSync(join(tmpdir(), "lfw-install-"));
  const stagedHarness = join(stage, "lfw");
  const backups = new Map<string, string>();
  const createdPaths: string[] = [];
  let createdGit = false;
  let createdDatabases: string[] = [];
  let preserveStage = false;
  try {
    copySource(stagedHarness);
    prepareDependencies(stagedHarness);
    if (!rootExists) { run("git", ["init", "-q"]); createdGit = true; }
    const common = gitCommonDirectory();
    for (const [path, content] of shared) {
      if (existsSync(path)) {
        const backup = join(stage, "backups", String(backups.size));
        mkdirSync(dirname(backup), { recursive: true });
        cpSync(path, backup);
        backups.set(path, backup);
      } else createdPaths.push(path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    renameSync(stagedHarness, harnessTarget);
    createdPaths.push(harnessTarget);
    for (const skill of requiredSkills) {
      const destination = join(projectRoot, ".agents/skills", skill);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(harnessTarget, "skills", skill), destination, { recursive: true });
      createdPaths.push(destination);
    }
    createdDatabases = [join(common, "harness-data/state.db"), join(common, "harness-data/memorygraph.db")]
      .filter((path) => !existsSync(path));
    initializeDatabases(common);
    writeFileSync(recordPath, `${JSON.stringify(recordForCurrent(nextVersion), null, 2)}\n`, { flag: "wx" });
    console.log(`하네스 ${nextVersion} 설치 완료: ${projectRoot}`);
  } catch (error) {
    const restoreErrors: string[] = [];
    for (const path of createdPaths.reverse()) {
      try { rmSync(path, { recursive: true, force: true }); } catch (e) { restoreErrors.push(`${path}: ${e}`); }
    }
    for (const [path, backup] of backups) {
      try { cpSync(backup, path); } catch (e) { restoreErrors.push(`${path}: ${e}`); }
    }
    for (const path of createdDatabases) {
      try { rmSync(path, { force: true }); } catch (e) { restoreErrors.push(`${path}: ${e}`); }
    }
    if (createdGit) {
      try { rmSync(join(projectRoot, ".git"), { recursive: true, force: true }); }
      catch (e) { restoreErrors.push(`.git: ${e}`); }
    }
    if (restoreErrors.length) {
      preserveStage = true;
      fail(`${error}\n복구 실패: ${restoreErrors.join("; ")}\n백업: ${stage}`);
    }
    throw error;
  } finally {
    if (!preserveStage) rmSync(stage, { recursive: true, force: true });
  }
}

function update(): void {
  const previous = parseRecord();
  if (!previous) fail("설치 기록이 없습니다. 먼저 install을 실행하세요.");
  const nextVersion = version();
  if (previous.harness_version === nextVersion) {
    console.log(`하네스 ${nextVersion}이 이미 설치되어 있습니다.`);
    return;
  }
  const compatibility = json(join(packageRoot, "installer/update-compatibility.json"));
  if (compatibility.format_version !== 1 || !Array.isArray(compatibility.compatible_from) ||
      !compatibility.compatible_from.every((value: unknown) => typeof value === "string")) {
    fail("업데이트 호환성 파일 형식이 잘못되었습니다.");
  }
  if (!compatibility.compatible_from.includes(previous.harness_version)) {
    fail(`${previous.harness_version}에서 ${nextVersion}으로 직접 업데이트할 수 없습니다. 공유 설정 또는 DB 이전이 필요할 수 있습니다.`);
  }
  checkPrerequisites();
  const common = gitCommonDirectory();
  for (const [path, expected] of Object.entries(previous.managed_files)) {
    const target = resolve(harnessTarget, path);
    if (!target.startsWith(`${harnessTarget}/`) || !existsSync(target) || hash(target) !== expected) {
      fail(`수정되었거나 없는 하네스 파일로 인해 업데이트를 중단합니다: lfw/${path}`);
    }
  }
  for (const [name, expected] of Object.entries(previous.installed_skills)) {
    const target = resolve(projectRoot, ".agents/skills", name);
    if (!target.startsWith(`${projectRoot}/.agents/skills/`) || !existsSync(target) || directoryHash(target) !== expected) {
      fail(`수정되었거나 없는 스킬로 인해 업데이트를 중단합니다: ${name}`);
    }
  }
  const stage = mkdtempSync(join(tmpdir(), "lfw-update-"));
  const stagedHarness = join(stage, "lfw");
  const oldHarness = join(stage, "previous-lfw");
  const oldSkills = join(stage, "previous-skills");
  const skillRoot = join(projectRoot, ".agents/skills");
  let applied = false;
  let preserveStage = false;
  try {
    copySource(stagedHarness);
    // Existing runtime data and user-added files are not owned by the installer.
    for (const rel of userFiles(harnessTarget)) {
      if (rel === "install.json" || previous.managed_files[rel]) continue;
      const source = join(harnessTarget, rel);
      const destination = join(stagedHarness, rel);
      if (!existsSync(destination)) {
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(source, destination);
      }
    }
    prepareDependencies(stagedHarness);
    for (const skill of requiredSkills) {
      const target = join(skillRoot, skill);
      if (existsSync(target) && !previous.installed_skills[skill]) fail(`새 스킬 이름 충돌: ${skill}`);
    }
    mkdirSync(oldSkills, { recursive: true });
    for (const skill of Object.keys(previous.installed_skills)) {
      cpSync(join(skillRoot, skill), join(oldSkills, skill), { recursive: true });
    }
    renameSync(harnessTarget, oldHarness);
    applied = true;
    renameSync(stagedHarness, harnessTarget);
    for (const skill of Object.keys(previous.installed_skills)) {
      rmSync(join(skillRoot, skill), { recursive: true, force: true });
    }
    for (const skill of requiredSkills) {
      cpSync(join(harnessTarget, "skills", skill), join(skillRoot, skill), { recursive: true });
    }
    // Initialization validates the existing shared databases without replacing them.
    initializeDatabases(common);
    writeFileSync(recordPath, `${JSON.stringify(recordForCurrent(nextVersion), null, 2)}\n`);
    console.log(`하네스 ${previous.harness_version} → ${nextVersion} 업데이트 완료`);
  } catch (error) {
    if (applied) {
      try {
        rmSync(harnessTarget, { recursive: true, force: true });
        renameSync(oldHarness, harnessTarget);
        for (const skill of new Set([...Object.keys(previous.installed_skills), ...requiredSkills])) {
          rmSync(join(skillRoot, skill), { recursive: true, force: true });
        }
        for (const skill of Object.keys(previous.installed_skills)) {
          cpSync(join(oldSkills, skill), join(skillRoot, skill), { recursive: true });
        }
      } catch (restoreError) {
        preserveStage = true;
        fail(`${error}\n복구 실패: ${restoreError}\n백업: ${stage}`);
      }
    }
    throw error;
  } finally {
    if (!preserveStage) rmSync(stage, { recursive: true, force: true });
  }
}

const command = process.argv[2];
try {
  if (command === "install") install();
  else if (command === "update") update();
  else fail("사용법: loomforwork install | update");
} catch (error) {
  console.error(`[lfw] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

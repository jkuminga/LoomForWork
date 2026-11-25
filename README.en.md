<div align="center">

# LoomForWork
![LoomForWork hero image](assets/loomforwork-hero.png)

A Codex harness that defines the work, records each run, and carries what you learn into the next task

[한국어](README.md)

</div>

&nbsp;

## 📖 Overview

LoomForWork organizes and records project work in Codex. It groups project capabilities into Features and the work for each capability into WIs (WorkItems).

When you select a WI for a Codex request, Codex can use its goal, acceptance criteria, user notes, and previous Runs (execution records) as context. At the end of a task, it records what was done and the result. Information worth keeping can be stored in a memory graph for later work. Work state and long-term memory persist across sessions and are shared by worktrees of the same Git repository.

Use LoomForWork to keep your tasks and work history in one place and make the next task easier to start.

&nbsp;

## 📦 Installation

### 1. Requirements

#### Supported operating system

- macOS

#### Prerequisites

- Codex Desktop App or CLI
- Bun
- uv
- Git
- Python >= 3.10
- fzf: Used to select the WorkItem to work on.

The installer may refuse to proceed if a prerequisite is missing.

### 2. Install

Run the following command from the **root directory of the project** where you want to use LoomForWork. You can install it in a new directory or an existing project.

```bash
bunx loomforwork@latest install
```

The installer adds the files shown below. It installs the harness source code and skills, and adds the required settings to files shared with your project, such as `AGENTS.md`, `.gitignore`, `.codex/config.toml`, `.codex/hooks.json`, and `package.json`, while preserving their existing contents.

```text
project root/
├── AGENTS.md                         # Adds harness instructions
├── package.json                      # Adds harness commands
├── .gitignore                        # Adds ignore rules for generated files
├── .codex/
│   ├── config.toml                   # Adds harness MCP server configuration
│   └── hooks.json                    # Adds start, recording, and stop hooks
├── .agents/
│   └── skills/                       # Adds harness skills
│       ├── work-start/
│       ├── work-finish/
│       ├── work-item-create/
│       ├── memory-finalize/
│       ├── mvp-to-prd/
│       ├── verify-prd/
│       └── extract-features/
└── lfw/
    ├── bin/                          # Harness commands
    ├── src/                          # Harness source code
    ├── skills/                       # Packaged skill sources
    ├── vendor/                       # Bundled external components
    ├── docs/                         # Harness documentation
    ├── pyproject.toml
    ├── uv.lock
    ├── schema.sql
    └── install.json                  # Installed version and managed-file record

Git common directory/
└── harness-data/
    ├── state.db                      # Work state database
    └── memorygraph.db                # Long-term memory database
```

### 3. Start the web console

```bash
bun run console
```

Or:

```bash
lfw/bin/harness-control-center
```

In the web console, you can create Features and WIs, browse registered items, track completed work, and inspect long-term memory saved during tasks. You can also add background information and decisions as WI memos for Codex to reference in later work.

### 4. Trust the hooks and verify the installation

Start a new Codex session after installation. If Codex asks you to trust the installed hooks, review and approve them. Hooks are scripts that run when Codex starts, records, and finishes work.

From the project root, check that the required files were installed:

```bash
bun run verify:install
```

Or:

```bash
lfw/bin/harness-verify-install
```

The command prints the path of any missing file. It checks whether files exist; it does not check whether the hooks execute correctly.

&nbsp;

## 🚀 Start your first task

### 1. Register Features and WIs

LoomForWork organizes project work into three units:

- **Feature:** A group of capabilities or an area of work in the project.
- **WorkItem (WI):** A task you ask Codex to perform, with a goal and acceptance criteria. A WI can belong to a Feature or stand on its own.
- **Run:** The record of one execution of a WI. Each time you work on the same WI, a new Run records what was done and the outcome.

You can create Features and WIs in two ways.

#### 1.1 Use the skills

LoomForWork includes skills that prepare Features and WIs from planning documents. See the [source record](lfw/skills/UPSTREAM.md) for their upstream origins and local changes.

If you have a PRD (product requirements document), use `extract-features` to produce candidate Features and WIs for each Feature. The skill writes the candidates to a JSON file. After reviewing the file, ask the agent to register the items you want to save as Features and WIs.

If you are starting with an MVP (minimum viable product) document, use `mvp-to-prd` to write a PRD, `verify-prd` to check it against the original MVP, and then `extract-features` to prepare the candidates.

#### 1.2 Register items directly

If you want to add Features and WIs yourself, or only need to register a few items in an existing project, use one of these methods:

- **Ask Codex:** Describe the purpose and content of the Feature or WI. When you ask Codex to register a complete WI, it saves a `ready` item with a goal, next action, and acceptance criteria. `ready` means the item is prepared for work.
- **Use the web console:** Register a new Feature or create a Draft WI. A Draft WI does not yet have a detailed execution plan. When you select it later, Codex uses its description and goal to define the plan and acceptance criteria.

### 2. Make a `w/` request

To work on a registered WI, put `w/` at the start of your request to Codex:

```text
w/ Implement the login screen
```

A WI picker opens in the terminal. Select the WI most relevant to your request. Codex reads its goal, acceptance criteria, memos, and previous Runs before starting work. If you select a Draft WI, Codex first uses its description and goal to define the execution plan and acceptance criteria.

Starting work creates a Run that records the progress and outcome of this execution. Working on the same WI again creates another Run, so you can review how the work progressed over time.

`w/` is optional. For an ordinary request without `w/`, LoomForWork does not select a WI or start a Run, so the work is not added to its execution history.

### 3. Workflow

After you select a WI, LoomForWork follows this flow:

```text
1. Prepare: Read the WI's goal, acceptance criteria, memos, and previous Runs.

2. Start a Run: Create a Run for this task and retrieve relevant long-term memory.

3. Work and record: Perform the requested work and record tool executions and memory candidates.

4. Review results: Check the tool records, save evidence for the WI's acceptance criteria,
   and store memory candidates that will be useful in later work.
```

#### Enable PreToolUse

- LoomForWork uses four hooks: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`.
- When enabled, `PreToolUse` restricts actions such as code edits and commits outside a `w/` request. It is disabled by default.

To enable the check before tool use, run this command from the project root:

```bash
./lfw/bin/harness-pre-tool-use-config enable
```

To disable it again:

```bash
./lfw/bin/harness-pre-tool-use-config disable
```

### 4. Work in another Git worktree

Git worktrees let you work on branches of one repository in separate directories. LoomForWork stores work state and long-term memory in the Git common directory, so worktrees of the same repository share WIs and previous work context. Each worktree can use files from its own branch while referring to that shared history.

The new worktree must contain the harness files and `.codex/config.toml`. During installation, the `cwd` (working directory) of each MCP server is set to the absolute path of the original worktree. From the root of a new worktree, update the `harness-state` and `harness-memory` server paths, then start a new Codex session:

```bash
bun run worktree:setup
```

&nbsp;

## 🔄 Updates

To apply an available update, run:

```bash
bunx loomforwork@latest update
```

You may customize the LoomForWork harness files and skills. If you modify files managed by the installer, a later update stops to protect your changes.

&nbsp;

## 🛠️ Troubleshooting

- **The installer says you are not at the Git repository root:** Run `git rev-parse --show-toplevel` to find the root, then run the installer there.
- **An update stops because files were modified:** Check for changes under `lfw/` or to installed skills under `.agents/skills/`. The installer does not overwrite those changes.

&nbsp;

## ⚖️ License

This repository is licensed under MIT. See [LICENSE](LICENSE) for details. The installed harness also includes [lfw/LICENSE](lfw/LICENSE).

The licenses and origins of bundled external sources and the skills based on them are recorded here:

- **MemoryGraph:** [License](lfw/vendor/memory-graph/LICENSE) · [Upstream](lfw/vendor/memory-graph/UPSTREAM.md)
- **Planning and Feature extraction skills:** [Source and changes](lfw/skills/UPSTREAM.md) · licenses: [mvp-to-prd](lfw/skills/mvp-to-prd/LICENSE) · [verify-prd](lfw/skills/verify-prd/LICENSE) · [extract-features](lfw/skills/extract-features/LICENSE)

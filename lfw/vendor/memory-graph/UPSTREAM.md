# MemoryGraph upstream provenance

- Source: https://github.com/memory-graph/memory-graph
- Version: `v0.13.0`
- Git commit: `67fc4f97816aa75823ae2dd4eff49f150cc6f1da`
- License: MIT. The full license and original copyright notice are in `LICENSE` beside this file in the installed `lfw/vendor/memory-graph/` directory.
- Original copyright notice: Copyright (c) 2024 Claude Code Memory Contributors.

The development repository originally checked out this commit as a Git submodule. Its files now live in `lfw/vendor/memory-graph/` as ordinary files; the Git submodule metadata is not distributed. LoomForWork maintains local dependency and integration changes in this snapshot. Review those changes against this commit when updating the vendored source.

The repository retains the upstream source, documentation, examples, and tests for maintenance. The npm package includes the SQLite runtime dependency closure, `ts/package.json`, `ts/bun.lock`, this provenance record, and the original MIT license. Root `.npmignore` excludes the other MemoryGraph documentation, examples, tests, development instructions, and unused modules from the npm tarball; it does not remove them from the repository.

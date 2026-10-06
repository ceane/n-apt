# Rust development cache

- [x] Keep dev-incremental at opt-level 3; enable incremental compilation and 16 codegen units.
- [x] Route interactive startup, noninteractive startup, and hot reload builds through rustBuild.mjs.
- [x] Collect successful Cargo compiler-artifact records, including fresh dependencies.
- [x] Prune unused dev-incremental deps older than 24 hours; preserve current artifacts, sibling Rust metadata, and dep-info.
- [x] Expire incremental caches after 14 days based on the newest nested write, replacing the global five-crate limit.
- [x] Hold Cargo's Unix profile .cargo-lock while pruning; defer when another Cargo command holds it.
- [x] Preserve caches on failed compilation or malformed output; cleanup errors do not fail successful builds.
- [x] Filesystem and fake-Cargo regression tests and TypeScript check passed.
- [ ] Measure actual rebuild time and runtime throughput on the operator's workload.

The first build after the profile change regenerates artifacts. Release retains opt-level 3, thin LTO, and one codegen unit, and now also enables incremental compilation.
Retention is not a hard disk quota: the current working set and recent generations are preserved.
Backend builds and tests use dev-incremental; production builds use release. Cargo still has an implicit built-in dev profile; its separate project configuration was removed. After a successful dev-incremental build, legacy native debug/dev-fast artifacts are retired under their own Cargo locks; busy profiles are deferred. Empty lock directories remain to preserve lock inode identity. WASM/custom target caches remain separate. No live target cache was deleted during implementation.
Automatic pruning requires python3 and Unix flock support. Windows builds explicitly skip automatic pruning.

Focused checks: node --test test/scripts/rust_artifact_cache.test.mjs

- [x] Removed dev-fast and the explicit dev profile configuration; updated orchestrator paths, npm backend/test commands, and CI to dev-incremental/release.

- [x] Verify retired-profile cleanup and preservation when a retired profile is locked; five regression tests pass. Final TypeScript check and Cargo metadata validation passed.

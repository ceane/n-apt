# Rust development cache

Profiles: dev-incremental and release, both incremental. Development retains
opt-level 3 and sixteen codegen units. Release retains thin LTO and one unit.
Backend build commands and hot reload use scripts/build/rustBuild.mjs.

## Successful-build cleanup

- [x] Read Cargo artifact messages, including fresh dependencies, target identities, and build-script OUT_DIR paths.
- [x] Immediately remove unused dependency artifacts and symbol bundles; no default 24-hour retention window.
- [x] Retain current hashed executables, metadata, dep-info, and split debug objects. Match copied macOS executables by content when inode identity does not apply.
- [x] Remove stale build-script output generations and fingerprints, retaining current output directories.
- [x] Retain the latest incremental generation per active Cargo target and one finalized session in each generation. Count library and binary targets separately when crate names match.
- [x] Remove abandoned working sessions and inactive crate generations immediately. Unknown incremental layouts retain the conservative fourteen-day expiry.
- [x] Remove the previous .old executable and its symbols after successful replacement compilation.
- [x] Serialize cleanup with Cargo's Unix profile lock; defer busy profiles and preserve failed-build caches.
- [x] Retire obsolete native dev-fast/debug caches under their own locks.
- [x] Twelve regression tests pass, including real Cargo unchanged-build and source-edit cycles with generated code and a same-name library/bin.
- [ ] Measure real N-APT disk size and edited-source rebuild throughput. The operator deleted the reported 16 GB target folder before this review.

Cleanup completes in the build wrapper before the orchestrator begins its backend
handoff. Changes to this wrapper apply to subsequent hot reload invocations; no
orchestrator restart is required for these wrapper changes.

Current working-set size is a floor, not a hard disk quota. Alternate feature/test
artifacts can need recompilation after eviction. Custom target/WASM/release caches
are separate. Automatic pruning requires python3 and Unix flock support; Windows
builds explicitly skip it. Empty retired lock directories preserve lock identity.

Focused check: node --test test/scripts/rust_artifact_cache.test.mjs

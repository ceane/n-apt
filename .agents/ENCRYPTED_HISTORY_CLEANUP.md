# Encrypted-module history cleanup plan

Status: planning only; no remote refs rewritten or pushed. Observations below
are a snapshot from 2026-10-27 and must be refreshed immediately before changes.

## Scope and evidence

- The local-only `encrypted-modules` branch contains protected plaintext and
  must never be pushed. Its source stays under `src/encrypted-modules/tmp/`.
- Local commit `e232d2ab` removes the newly exposed test copies from the ML
  branch and syncs the encrypted bundle. It is not pushed.
- Older plaintext audio training code is reachable from commit `0f512be7`,
  which is an ancestor of the locally cached `origin/main` and multiple other
  remote-tracking refs. The earlier move to encrypted modules is `3d8297b2`.
  Earlier classifier and vision implementations also need inventory.
- `git ls-remote` observed 29 branch heads, no tags, and 69 pull-request head
  refs. Remote branch heads must be fetched and checked for ancestry; do not
  assume the local tracking refs cover all advertised heads.
- An unpushed ML checkpoint and unrelated local RS/TS bundle changes exist.
  Preserve them and the protected local branch during any preparation.

## Refreshed inventory

- GitHub reports the repository is public; there are no open pull requests in
  the connected search result. There are 69 advertised pull-request head refs,
  including closed historical pull requests. A temporary local audit of those
  refs found that 17 reach each of the sampled audio, classifier and vision
  commits; the temporary audit refs were removed after the check.
- After fetching advertised branch heads, each of the sampled audio, classifier
  and vision introduction commits is an ancestor of 18 of 29 remote heads,
  including `main` and `codex/ml-follow-up`.
- An initial scan of 68 paths deleted by the encryption migration found 209
  distinct named historical object IDs. This is not an exhaustive blob list:
  modified-in-place files, historical renames, shared blobs and PR-only refs
  remain to be identified, and path overlap alone does not prove current files
  contain protected implementations.
- `main` is protected by an active `Protect Main` ruleset with a
  non-fast-forward restriction. Any bypass or ruleset modification requires a
  separately reviewed plan; never silently weaken protections.

## Procedure

1. Inventory protected paths and blob contents from the pre-encryption commits,
   including historical renames, generated copies, tests and documentation.
   Classify current dispatch wrappers separately from protected implementation;
   do not remove unrelated public code merely because it shares a path.
2. Refresh all remote refs, record expected SHA values, and identify every
   branch and tag that reaches a protected blob. Inventory pull-request refs,
   forks and clones separately. Capture any branch protections and open PRs.
3. Agree on the protected-path inventory, affected remote refs, maintenance
   window and collaborator recovery plan. Do not change remote refs until the
   user has reviewed the exact proposed scope.
4. Build a rewrite in an isolated repository without modifying the protected
   source worktree. Preserve current safe wrappers, encrypted bundles, branch
   tips and intended unrelated work. Retain old-to-new commit maps securely;
   rewritten objects and backups can still contain protected plaintext.
5. Compare every rewritten branch tip with its original tree, accounting only
   for explicitly approved removals. Scan all reachable rewritten commits and
   historical renames for protected blobs. Verify encrypted bundle extraction,
   focused tests and representative build/type checks. Confirm no protected
   `tmp/` paths enter a consumer branch or any branch slated for publication.
6. Recheck every remote SHA. Push only explicitly approved rewritten refs with
   exact `--force-with-lease` expectations, preserving required branch
   protections and coordinating any temporary changes to them. Do not push the
   `encrypted-modules` branch. Stop on any mismatch or failed check.
7. Verify remote ref SHAs and fetch the rewritten refs into a clean verifier;
   repeat protected-blob scans. Coordinate collaborator reclones or careful
   rebases so old history is not reintroduced. Pull-request refs, forks,
   cached views and old clones may retain data; coordinate with the hosting
   provider for any necessary retention or garbage-collection actions. A
   branch rewrite alone does not guarantee erasure.

## Before proceeding

The history rewrite changes shared commit IDs, affects PRs and collaborators,
may invalidate signatures, and cannot revoke copies already made. Review the
inventory and exact remote-ref update plan before execution. If any exposed
content contains credentials or keys, rotate those separately; rewriting Git
history is not credential revocation.

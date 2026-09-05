# Working patterns

## Focused commits in a dirty worktree

Preserve unrelated user changes. Before staging, inspect `git status -sb` and
the full diff. Group related changes by behavior, and use path or hunk
selection (`git add <paths>` or `git add -p`) instead of staging the whole
worktree. For a mixed file, stage only the intended hunks and verify with:

```sh
git diff --cached --name-status
git diff --cached --check
```

Commit each verified group with a specific message. Use `git commit --only`
when the commit must be limited to explicit paths. After hooks run, recheck
the staged diff and worktree, then push only the commits that were reviewed
and tested.

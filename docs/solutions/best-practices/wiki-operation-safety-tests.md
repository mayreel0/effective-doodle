---
title: Test operational scripts against destructive failure modes
date: 2026-08-06
category: best-practices
module: LLM Markdown Wiki scaffold
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Writing shell scripts that move, delete, publish, scan, or commit project knowledge-base files"
tags: [operations, shell-safety, wiki, verification]
---

# Test operational scripts against destructive failure modes

## Context

The wiki scaffold started with sensible happy-path scripts for snapshotting a vault, publishing Quartz output, and reporting Syncthing conflicts. Final review still found three operational failure modes that ordinary syntax tests could not catch:

- a vault initialized on a different branch could make snapshot pushes misleading or broken
- a failed final publish could leave the live static site missing
- a failed conflict-file traversal could report a false clean result

## Guidance

For operations scripts, test the dangerous failure modes directly, not just the success path.

Concrete guardrails now in this scaffold:

- [scripts/wiki-snapshot.sh](../../../scripts/wiki-snapshot.sh) checks that the vault is on `WIKI_GIT_BRANCH` before staging or committing, and refuses detached or mismatched branches near line 18.
- [scripts/wiki-build.sh](../../../scripts/wiki-build.sh) checks same-filesystem promotion and restores the previous public site if final promotion fails near line 141.
- [scripts/wiki-conflicts.sh](../../../scripts/wiki-conflicts.sh) treats `find | sort` traversal failure as a script failure before printing clean output near line 16.

Each behavior has a focused regression test:

- `tests/test_wiki_snapshot_safety.sh` covers branch mismatch before snapshotting.
- `tests/test_wiki_build_safety.sh` covers path overlap, failed builds, and failed final promotion rollback.
- `tests/test_wiki_conflicts_safety.sh` covers scan traversal failure.

## Why This Matters

Operations scripts often look correct when the normal path succeeds. The damaging bugs appear when an environment variable points to the wrong path, a command fails inside a subshell, a filesystem move behaves differently than expected, or Git defaults differ by host.

The right test shape is fault injection with temporary fixtures: fake `npm`, `npx`, `mv`, or `find`; temporary Git repositories; and assertions that existing user data remains unchanged after failure.

## When to Apply

- A script uses `rm -rf`, `mv`, `rsync --delete`, `git add`, `git commit`, or `git push`.
- A script reports a clean or safe state after scanning files.
- A script publishes generated output over a previously working site.
- A script depends on host defaults such as Git branch names, remotes, or filesystem layout.

## Examples

Before:

```bash
bash -n scripts/wiki-build.sh
```

After:

```bash
bash tests/test_wiki_build_safety.sh
bash tests/test_wiki_snapshot_safety.sh
bash tests/test_wiki_conflicts_safety.sh
```

The first command proves the scripts parse. The latter commands prove the scripts fail safely.

## Related

- [LLM Markdown Wiki Implementation Plan](../../superpowers/plans/2026-08-06-llm-markdown-wiki.md)

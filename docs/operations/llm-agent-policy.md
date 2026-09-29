# LLM Agent Policy

## Allowed Reads

The agent may read Markdown files, attachments, and Git history inside `/srv/wiki/vault`.

## Default Write Zones

The agent may create and edit files under:

- `/srv/wiki/vault/_llm/drafts/`
- `/srv/wiki/vault/_llm/logs/`
- `/srv/wiki/vault/_llm/indexes/`

For automatic project knowledge capture, the additional agent-owned write zone is:

`${OBSIDIAN_VAULT_DIR}/10-Projects/<Project Name>/_llm/knowledge/<stable-topic>.md`

`/srv/wiki/vault` above is the server-side path for the same Vault; coding agents use `OBSIDIAN_VAULT_DIR` on their local machine. Take `<Project Name>` from the project's managed `AGENTS.md` wiki root, never from a guess. Use a stable, date-free topic slug matching `[a-z0-9]+(-[a-z0-9]+)*`; do not accept arbitrary path input as a topic.

Before writing, resolve the Vault and existing project ancestors with `realpath`, reject `..` and symlink components in the relative path, and verify that the target's canonical parent remains beneath the canonical project `_llm/knowledge/` directory. If the knowledge directory does not exist, validate its existing parent before creation and re-check the canonical path afterward. Reject a project directory that resolves outside the Vault or into the source repository. Never use the source repository as a fallback storage location.

Only agent-owned notes in this zone may be created or updated automatically. Mark newly created notes with `managed_by: llm-agent` and `llm_content_sha256: <hex digest>` in YAML frontmatter; location alone does not prove ownership. The digest covers the exact note bytes with only the digest line removed. Before any update, recompute that digest and replace the note only if it matches; a missing or mismatched digest means the note is read-only and the conflict must be reported. Do not overwrite human edits even when the ownership marker remains. Search related project notes first. A note without the ownership marker is human-authored for this purpose and remains read-only. An explicit request to edit a human note follows the Direct Human Note Edits and Proposed Edit Zone rules below. A captured conclusion must include a source or evidence reference and its rationale, not just a chronological task log.

New automatic notes are private: do not add `visibility: public` or perform a publication step. If an agent-managed note was made manually public (its frontmatter has `visibility: public`), or its publication status is unclear, do not update it automatically; report that it needs human review before changing published content. Private-site authentication does not make it safe to store raw secrets, credentials, tokens, cookies, personal identifiers, or unredacted sensitive paths. Omit or replace sensitive values with placeholders before writing, including in evidence references.

Use a hidden temporary file in the same private directory, with a name that does not end in `.md`, and atomic replacement for note updates; check the existing digest again immediately before replacement. Include the recomputed `llm_content_sha256` of the new content in that same atomic replacement, so the next update can validate it. On failure remove only that temporary file and leave the previous note untouched. If `OBSIDIAN_VAULT_DIR` is unavailable or unwritable, continue the development task, do not write into the source repository, and report that knowledge capture did not occur. A failed or partial write must not be described as a saved note.

## Proposed Edit Zone

When a requested change may rewrite or substantially alter a human-authored note, the agent must write a proposal under:

- `/srv/wiki/vault/_llm/proposed-edits/`

## Direct Human Note Edits

- Routine, narrow edits outside `_llm/` may be applied directly only when the user explicitly asks for that exact edit.
- Substantial rewrites, deletions, restructures, or ambiguous risky changes outside `_llm/` must always go through `_llm/proposed-edits/` first.

## Required After Write

After any write, the agent must run:

```bash
git -C /srv/wiki/vault status --short
```

For intentional changes, the agent must commit with a message beginning with one of:

- `[LLM draft]`
- `[LLM edit]`
- `[LLM index]`
- `[LLM log]`

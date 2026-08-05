# LLM Markdown Wiki System Design

## Purpose

Build a personal knowledge base system where Obsidian remains the primary authoring interface, a Linux home server hosts the same Markdown vault as a web wiki, and an LLM agent can read and write project documentation directly as Markdown.

The system favors simple files, recoverability, and low operational weight over collaborative permissions or database-backed wiki features.

## Decision Summary

Use:

- Obsidian Vault as the source Markdown structure.
- Syncthing for near-real-time PC-to-server file synchronization.
- Git for history, rollback, auditing, and LLM-generated change tracking.
- Quartz for rendering the vault as a lightweight web wiki.
- A server-side LLM agent that works against the Markdown filesystem, with optional RAG indexing added later.

Do not use Wiki.js for the initial version. Wiki.js is useful for teams, users, permissions, and database-backed editing, but it adds unnecessary operational weight for a personal Obsidian-first vault.

## Architecture

```text
Main PC Obsidian Vault
        |
        | Syncthing
        v
Linux home server /srv/wiki/vault
        |
        | Git snapshots and audit history
        v
Private Git repository
        |
        | Quartz static build
        v
Nginx or Caddy web wiki
        |
        | Filesystem access and optional RAG index
        v
LLM agent
```

## Components

### Obsidian Vault

The vault is the human-owned source of truth. Obsidian can use its normal folder, wikilink, attachment, frontmatter, tag, and plugin conventions.

Recommended top-level structure:

```text
vault/
  00-Inbox/
  10-Projects/
  20-Areas/
  30-Resources/
  40-Archive/
  _llm/
    drafts/
    logs/
    proposed-edits/
    indexes/
```

The `_llm/` directory separates agent-generated output from human-maintained notes.

### Sync Pipeline

Syncthing handles frequent file sync between the main PC and the Linux server. It should ignore volatile local state such as:

```text
.obsidian/workspace*
.obsidian/cache
.trash/
.stversions/
node_modules/
public/
.quartz-cache/
```

Git runs on the server as a durability and audit layer. A scheduled job commits clean vault changes with timestamped messages. LLM agent changes should use explicit commit messages such as:

```text
[LLM draft] add homelab wiki architecture note
[LLM edit] update project status index
[Human] refine sync policy
```

Git is not the primary real-time sync mechanism in the first version. It is the recovery, review, and backup mechanism.

### Web Wiki

Quartz renders the vault because it supports Obsidian-flavored Markdown, wikilinks, backlinks, graph view, transclusions, frontmatter, Mermaid, and static deployment.

Quartz should read from the synchronized vault content and build to a separate static output directory. The web server should serve only the static output, not the writable vault.

Recommended paths:

```text
/srv/wiki/vault
/srv/wiki/quartz
/srv/wiki/public
```

### LLM Agent

The LLM agent runs on the server and can:

- Search notes.
- Read Markdown files.
- Create project logs and summaries.
- Draft new notes.
- Propose edits to existing notes.
- Maintain generated indexes.

Default write policy:

- Free writes allowed under `_llm/drafts/`, `_llm/logs/`, and `_llm/indexes/`.
- Existing human-authored notes should be edited only when the task explicitly asks for it.
- Risky edits should be written under `_llm/proposed-edits/` first.
- Every agent write should be followed by a Git status check and an intentional commit.

### RAG

Initial version should use direct filesystem search instead of a vector database. Markdown files are searchable with `rg`, readable by path, and already structured by headings and links.

Add RAG later when the vault becomes too large for direct search workflows. The preferred second-stage path is Open WebUI plus Ollama or an external vector database such as Qdrant. Markdown header splitting should be enabled when indexing Markdown so note structure is preserved.

## Error Handling And Safety

Syncthing conflict files must be treated as review items, not normal notes. A scheduled check should report files matching:

```text
*.sync-conflict-*.md
```

Quartz build failures should not delete the previous published site. Static publishing should build into a temporary directory, then swap the output only after a successful build.

LLM edits should be recoverable through Git. The agent should avoid rewriting large note collections in one operation.

## Testing And Verification

Initial implementation should verify:

- A note created on the main PC appears on the server.
- A server-side Git commit captures the synced note.
- Quartz builds successfully from the vault.
- The rendered wiki exposes wikilinks, backlinks, and search.
- The LLM agent can create a draft note under `_llm/drafts/`.
- A conflict file can be detected and reported.

## Implementation Scope

The first implementation plan should cover:

1. Initialize repository and vault layout.
2. Define Syncthing ignore rules.
3. Add server path conventions and service layout.
4. Add Quartz setup and build script.
5. Add Git snapshot script and scheduled service.
6. Add LLM agent access policy and command interface.
7. Add verification checklist.

Out of scope for the first version:

- Multi-user permissions.
- Wiki.js deployment.
- Full vector database RAG.
- Automatic large-scale note rewriting.
- Public internet exposure before local-only operation is verified.

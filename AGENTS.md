<!-- project-wiki-mode:start -->
# Agent Instructions

## Project Wiki Mode

This project captures durable knowledge privately after ordinary development work. An explicit wiki-mode request may also ask for broader wiki maintenance.

### Work Root

Do actual implementation, debugging, testing, and command execution in this repository, meaning the directory that contains this `AGENTS.md` file.

Do not create project wiki documents inside this repository unless the user explicitly asks.

### Required Environment

Before writing wiki documents, confirm that this environment variable is set:

`OBSIDIAN_VAULT_DIR`

It must point to the local Obsidian Vault root. If it is missing or unwritable, finish the development task without a wiki write and report that capture did not occur only if durable knowledge would have been saved. Ask for the location only when the user specifically requests a wiki document.

### Wiki Root

Store project wiki documents in the Obsidian Vault:

`${OBSIDIAN_VAULT_DIR}/10-Projects/LLM Markdown Wiki System`

Create the folder only after verifying that the Vault is configured, writable, and outside the source repository.

### Shared Rules

When available, follow the shared Project Wiki Mode rules:

`${OBSIDIAN_VAULT_DIR}/10-Projects/LLM Markdown Wiki System/08 Project Wiki Mode.md`

### Automatic Private Knowledge Capture

After an ordinary development task, check whether it produced durable decisions and their rationale, non-obvious constraints, reusable concepts, or failures and fixes. No separate wiki-mode request is required.

- If no reusable knowledge emerged, write no note. Do not turn routine steps, command transcripts, or implementation summaries into notes.
- Separate what the source or tests confirm from interpretation: distinguish confirmed facts from inferences, and include a source or evidence reference for each conclusion.
- Write only under `${OBSIDIAN_VAULT_DIR}/10-Projects/LLM Markdown Wiki System/_llm/knowledge/<stable-topic>.md`; take the project name from this Wiki Root and use a safe, date-free topic slug. New notes are private: do not add `visibility: public` or include raw secrets, credentials, personal identifiers, or sensitive paths.
- Check relevant existing project notes first. Create new notes with YAML frontmatter `managed_by: llm-agent` and `llm_content_sha256` (SHA-256 of exact note bytes excluding only the digest line). If the topic path already exists, do not overwrite it or create a duplicate; report that capture was skipped. Safe updates and human-note conflict handling come later.
- Verify the Vault and target directory are outside this repository, reject unsafe path components, and use a private temporary file with a no-overwrite install. If the Vault is unavailable or a write fails, finish the development task, remove only the temporary file, and report that capture did not occur. Never claim a failed write succeeded or fall back to a repository file.

### Explicit Wiki Maintenance

When the user explicitly requests broader wiki maintenance, record important decisions and failures in `90 Logs/`, stable commands in `03 Operations Runbook.md`, fixes in `04 Troubleshooting.md`, and reusable concepts in `05 Knowledge Map.md`. Preserve human-authored content and keep wiki work secondary to the development task.

### Public Documents

Only when the user explicitly requests publication, add this frontmatter to documents that are safe to publish:

```md
---
visibility: public
---
```

Never include real sensitive values in public documents.

Do not expose real domains, internal IPs, usernames, hostnames, SSH ports, Device IDs, tokens, cookies, API keys, private repository URLs, local home paths, or raw secrets.

Use placeholders such as `example.com`, `192.0.2.10`, `user`, `/path/to/project`, and `private repository`.

### If Unsure

If unsure where to store wiki documents, ask before writing.

Do not default to writing wiki documents into the current repository.
<!-- project-wiki-mode:end -->

## Development Workflow

- Keep investigation narrow: read the relevant issue, changed files, and nearby tests before expanding the search. Summarize repetitive command output, but preserve source contracts and failure details.
- Match verification to the change's risk. Run focused checks while developing and the full `npm test` suite before proposing a PR. Do not trade away security, error handling, or test coverage to save tokens.
- Completion criteria should include representative usage commands and their expected results. Review the actual diff for behavior and regression risks; seek independent review for changes involving repository boundaries, secrets, deletion, persistence, or concurrency. Avoid repeating unrelated historical context or requesting multiple equivalent reviews without a concrete reason.
- Use Tokscale measurements as aggregate observations, not per-issue savings claims. Compare like-for-like work before claiming an optimization helped.

# LLM Markdown Wiki

Operations scaffold for a personal Obsidian, Syncthing, Git, Quartz, and LLM-agent Markdown wiki.

The Markdown vault is the source of truth. The Linux server syncs the vault, snapshots it with Git, renders it with Quartz, and allows LLM agents to work inside controlled Markdown folders.

## Operating Map

- Start with `docs/operations/server-bootstrap.md`.
- Use `config/wiki.env.example` as the server environment template.
- Use `config/syncthing/stignore.example` as the Syncthing ignore template.
- Use `scripts/wiki-snapshot.sh` for Git durability snapshots.
- Use `scripts/wiki-build.sh` for Quartz publishing.
- Use `scripts/wiki-conflicts.sh` to detect Syncthing conflict files.
- Use `docs/operations/llm-agent-policy.md` before granting an LLM agent write access.

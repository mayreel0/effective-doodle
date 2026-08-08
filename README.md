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
- Use `scripts/wiki-init-project.sh` to initialize Project Wiki Mode for another repository.
- Use `docs/operations/project-wiki-mode.md` to apply this system to other projects.
- Use `docs/operations/llm-agent-policy.md` before granting an LLM agent write access.

## Project Wiki Mode

Install the project initializer once:

```bash
scripts/install-wiki-tools.sh
```

Then run it from any project repository:

```bash
wiki-init-project --agents-only "Project Name"
```

This creates `AGENTS.md` in the current repository so LLM agents know where project wiki documents belong.

Set the real vault location when the agent needs to create or update wiki documents:

```bash
export OBSIDIAN_VAULT_DIR="/path/to/Obsidian Vault"
wiki-init-project "Project Name"
```

The generated `AGENTS.md` intentionally keeps `${OBSIDIAN_VAULT_DIR}` references instead of resolved personal paths.

# Project Wiki Mode

Project Wiki Mode lets this repository act as a reusable toolset for other projects. The wiki system repository keeps the scripts and policy; each working project only needs an `AGENTS.md` file that tells LLM agents where its wiki documents belong.

## Install Once

Install the helper command on the local machine:

```bash
scripts/install-wiki-tools.sh
```

The installer creates:

```text
$HOME/.local/bin/wiki-init-project
```

Make sure `$HOME/.local/bin` is on `PATH` before using it from another project.

## Initialize Another Project

From the root of the project being worked on:

```bash
wiki-init-project --agents-only "Project Name"
```

This creates only:

```text
AGENTS.md
```

It does not create wiki documents, and it does not need the actual Obsidian Vault path. The generated `AGENTS.md` intentionally keeps `${OBSIDIAN_VAULT_DIR}` references instead of writing personal absolute paths.

If `AGENTS.md` already exists, the command preserves the existing file and adds a managed Project Wiki Mode block. Re-running the command updates that managed block instead of duplicating it or replacing unrelated project rules.

## Create Project Wiki Documents

When starter wiki documents are needed, provide the real Vault root:

```bash
export OBSIDIAN_VAULT_DIR="/path/to/Obsidian Vault"
wiki-init-project "Project Name"
```

This creates:

```text
${OBSIDIAN_VAULT_DIR}/10-Projects/Project Name/
  00 Overview.md
  03 Operations Runbook.md
  04 Troubleshooting.md
  05 Knowledge Map.md
  90 Logs/
```

## Agent Workflow

After `AGENTS.md` exists, the user can ask:

```text
Work on this project in wiki mode.
```

The agent should:

- do implementation and tests in the current repository
- write project notes in `${OBSIDIAN_VAULT_DIR}/10-Projects/<Project Name>/`
- record volatile work details in `90 Logs/`
- promote stable commands to `03 Operations Runbook.md`
- promote failures and fixes to `04 Troubleshooting.md`
- promote reusable concepts to `05 Knowledge Map.md`

## Permission Model

Many coding agents treat the current repository and the Obsidian Vault as different write roots. If the Vault is outside the agent workspace, the agent may ask for write approval before editing wiki documents.

That is expected. To reduce prompts, configure the agent so the Obsidian Vault is included as a writable workspace root. Do not solve this by writing wiki files into the project repository.

## Public Safety

Project wiki documents may be public or private. Public documents must opt in:

```md
---
visibility: public
---
```

Public documents must not contain real domains, internal IPs, usernames, hostnames, SSH ports, Device IDs, tokens, cookies, API keys, private repository URLs, local home paths, or raw secrets.

Use placeholders such as:

```text
example.com
192.0.2.10
user
/path/to/project
private repository
```

## Verification

Run:

```bash
bash tests/test_wiki_init_project.sh
bash tests/test_wiki_tool_install.sh
```

These tests verify that:

- `AGENTS.md` is created in the selected project root
- repo-internal Vault paths are rejected
- `--agents-only` does not require a real Vault path
- generated `AGENTS.md` does not leak resolved personal paths
- the installed `wiki-init-project` command works from another project directory

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  wiki-init-project.sh [--force] [--public] [--agents-only] [--allow-repo-vault] [--project-root PATH] [--vault-root PATH] PROJECT_NAME

Creates:
  PROJECT_ROOT/AGENTS.md
  VAULT_ROOT/10-Projects/PROJECT_NAME/

Defaults:
  PROJECT_ROOT: current directory
  VAULT_ROOT:   $OBSIDIAN_VAULT_DIR

Environment:
  OBSIDIAN_VAULT_DIR must point to the local Obsidian Vault root unless
  --vault-root is provided, or --agents-only is used.
USAGE
}

force=0
public_docs=0
allow_repo_vault=0
agents_only=0
project_root="$PWD"
vault_root="${OBSIDIAN_VAULT_DIR:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force)
      force=1
      shift
      ;;
    --public)
      public_docs=1
      shift
      ;;
    --allow-repo-vault)
      allow_repo_vault=1
      shift
      ;;
    --agents-only)
      agents_only=1
      shift
      ;;
    --project-root)
      [ "$#" -ge 2 ] || {
        usage >&2
        exit 2
      }
      project_root="$2"
      shift 2
      ;;
    --vault-root)
      [ "$#" -ge 2 ] || {
        usage >&2
        exit 2
      }
      vault_root="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

[ "$#" -eq 1 ] || {
  usage >&2
  exit 2
}

project_name="$1"

if [ -z "$project_name" ]; then
  echo "PROJECT_NAME must not be empty." >&2
  exit 2
fi

absolute_dir() {
  local label="$1"
  local path="$2"

  case "$path" in
    /*) ;;
    *)
      echo "$label must be an absolute path: $path" >&2
      exit 2
      ;;
  esac

  mkdir -p "$path"
  (cd -P "$path" && pwd)
}

is_same_or_descendant() {
  local ancestor="$1"
  local candidate="$2"

  [ "$ancestor" = "/" ] || [[ "$candidate" = "$ancestor" || "$candidate" = "$ancestor"/* ]]
}

frontmatter() {
  local title="$1"

  if [ "$public_docs" -eq 1 ]; then
    cat <<FRONTMATTER
---
title: $title
visibility: public
tags:
  - project/wiki
---

FRONTMATTER
  else
    cat <<FRONTMATTER
---
title: $title
tags:
  - project/wiki
---

FRONTMATTER
  fi
}

write_if_missing() {
  local path="$1"
  local title="$2"
  local body="$3"

  if [ -f "$path" ]; then
    return
  fi

  {
    frontmatter "$title"
    printf '%s\n' "$body"
  } > "$path"
}

project_root="$(absolute_dir 'Project root' "$project_root")"
if [ -z "$vault_root" ] && [ "$agents_only" -ne 1 ]; then
  cat >&2 <<ERROR
OBSIDIAN_VAULT_DIR is not set.

Set it to the local Obsidian Vault root, for example:
  export OBSIDIAN_VAULT_DIR="/path/to/Obsidian Vault"

Or pass the vault root for this run:
  --vault-root "/path/to/Obsidian Vault"
ERROR
  exit 2
fi

if [ -n "$vault_root" ] && [ "$agents_only" -ne 1 ]; then
  vault_root="$(absolute_dir 'Vault root' "$vault_root")"
fi

if [ -n "$vault_root" ] && [ "$agents_only" -ne 1 ] && [ "$allow_repo_vault" -ne 1 ] && is_same_or_descendant "$project_root" "$vault_root"; then
  cat >&2 <<ERROR
Vault root must not be inside the project repository:
  project root: $project_root
  vault root:   $vault_root

Use the real Obsidian Vault root, for example:
  --vault-root "/path/to/Obsidian Vault"

If you are intentionally creating a throwaway fixture, re-run with --allow-repo-vault.
ERROR
  exit 1
fi

wiki_dir=""
if [ -n "$vault_root" ] && [ "$agents_only" -ne 1 ]; then
  wiki_dir="$vault_root/10-Projects/$project_name"
fi
logs_dir="$wiki_dir/90 Logs"
agents_wiki_dir="\${OBSIDIAN_VAULT_DIR}/10-Projects/$project_name"
agents_shared_rules="\${OBSIDIAN_VAULT_DIR}/10-Projects/LLM Markdown Wiki System/08 Project Wiki Mode.md"
agents_file="$project_root/AGENTS.md"

if [ -f "$agents_file" ] && [ "$force" -ne 1 ]; then
  echo "AGENTS.md already exists: $agents_file" >&2
  echo "Re-run with --force to replace it." >&2
  exit 1
fi

cat > "$agents_file" <<AGENTS
# Agent Instructions

## Project Wiki Mode

When the user says "위키 모드", "Project Wiki Mode", or asks to work on this project with wiki documentation, follow these rules.

### Work Root

Do actual implementation, debugging, testing, and command execution in this repository, meaning the directory that contains this \`AGENTS.md\` file.

Do not create project wiki documents inside this repository unless the user explicitly asks.

### Required Environment

Before writing wiki documents, confirm that this environment variable is set:

\`OBSIDIAN_VAULT_DIR\`

It must point to the local Obsidian Vault root. If it is missing, ask the user for the vault location before writing wiki documents.

### Wiki Root

Store project wiki documents in the Obsidian Vault:

\`$agents_wiki_dir\`

If the folder does not exist, create it.

### Shared Rules

Follow the shared Project Wiki Mode rules:

\`$agents_shared_rules\`

### During Work

- Solve the user's actual task first.
- Record important decisions and failures in \`90 Logs/\`.
- Promote stable setup and operation commands to \`03 Operations Runbook.md\`.
- Promote failures and fixes to \`04 Troubleshooting.md\`.
- Promote reusable concepts to \`05 Knowledge Map.md\`.
- Do not spend excessive time polishing wiki docs during active implementation.

### After Work

Before calling the task complete, update the project wiki with:

- What changed
- How it was verified
- Important decisions
- New operations commands
- Troubleshooting notes
- Reusable knowledge

### Public Documents

Only add this frontmatter to documents that are safe to publish:

\`\`\`md
---
visibility: public
---
\`\`\`

Never include real sensitive values in public documents.

Do not expose real domains, internal IPs, usernames, hostnames, SSH ports, Device IDs, tokens, cookies, API keys, private repository URLs, local home paths, or raw secrets.

Use placeholders such as \`example.com\`, \`192.0.2.10\`, \`user\`, \`/path/to/project\`, and \`private repository\`.

### If Unsure

If unsure where to store wiki documents, ask before writing.

Do not default to writing wiki documents into the current repository.
AGENTS

if [ "$agents_only" -ne 1 ]; then
  mkdir -p "$logs_dir"

  write_if_missing "$wiki_dir/00 Overview.md" "$project_name Overview" "# $project_name

## Purpose

Describe what this project is for.

## Current Status

Initial Project Wiki Mode scaffold created.

## Links

- [[03 Operations Runbook]]
- [[04 Troubleshooting]]
- [[05 Knowledge Map]]
- [[90 Logs/$(date '+%Y-%m-%d') Project Started]]
"

  write_if_missing "$wiki_dir/03 Operations Runbook.md" "$project_name Operations Runbook" "# $project_name Operations Runbook

## Common Commands

Add setup, run, test, deploy, and verification commands here.

## Routine Checks

Add recurring checks here.
"

  write_if_missing "$wiki_dir/04 Troubleshooting.md" "$project_name Troubleshooting" "# $project_name Troubleshooting

## Known Issues

Record symptoms, causes, fixes, and verification here.
"

  write_if_missing "$wiki_dir/05 Knowledge Map.md" "$project_name Knowledge Map" "# $project_name Knowledge Map

## Keywords

| Keyword | Meaning | Source |
| --- | --- | --- |

## Reusable Knowledge

Add project concepts that should survive beyond one task.
"

  write_if_missing "$logs_dir/$(date '+%Y-%m-%d') Project Started.md" "$project_name Project Started" "# $project_name Project Started

Project Wiki Mode was initialized.

## Created

- \`AGENTS.md\` in the project repository
- Project wiki folder in the Obsidian Vault
- Starter Overview, Operations Runbook, Knowledge Map, and Logs
"
fi

cat <<SUMMARY
Project Wiki Mode initialized.

Project root:
  $project_root

Wiki root:
  ${wiki_dir:-"\${OBSIDIAN_VAULT_DIR}/10-Projects/$project_name"}

Created or updated:
  $agents_file
SUMMARY

if [ "$agents_only" -ne 1 ]; then
  cat <<SUMMARY
  $wiki_dir/00 Overview.md
  $wiki_dir/03 Operations Runbook.md
  $wiki_dir/04 Troubleshooting.md
  $wiki_dir/05 Knowledge Map.md
  $logs_dir/$(date '+%Y-%m-%d') Project Started.md
SUMMARY
fi

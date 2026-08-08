#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

project_root="$tmp_root/project-repo"
vault_root="$tmp_root/Obsidian Vault"

mkdir -p "$project_root" "$vault_root"

"$repo_dir/scripts/wiki-init-project.sh" \
  --project-root "$project_root" \
  --vault-root "$vault_root" \
  "Shopping App"

agents_file="$project_root/AGENTS.md"
wiki_dir="$vault_root/10-Projects/Shopping App"

test -f "$agents_file" ||
  fail 'AGENTS.md was not created in the project root'
test -f "$wiki_dir/00 Overview.md" ||
  fail 'Overview was not created in the wiki project folder'
test -f "$wiki_dir/03 Operations Runbook.md" ||
  fail 'Operations runbook was not created in the wiki project folder'
test -f "$wiki_dir/04 Troubleshooting.md" ||
  fail 'Troubleshooting was not created in the wiki project folder'
test -f "$wiki_dir/05 Knowledge Map.md" ||
  fail 'Knowledge map was not created in the wiki project folder'
test -d "$wiki_dir/90 Logs" ||
  fail 'Logs folder was not created in the wiki project folder'
test -f "$wiki_dir/90 Logs/$(date '+%Y-%m-%d') Project Started.md" ||
  fail 'Initial project log was not created'

grep -Fq 'Do not create project wiki documents inside this repository' "$agents_file" ||
  fail 'AGENTS.md does not protect the repository from wiki document drift'
grep -Fq '08 Project Wiki Mode.md' "$agents_file" ||
  fail 'AGENTS.md does not reference the shared Project Wiki Mode rules'
if grep -Fq "$project_root" "$agents_file"; then
  fail 'AGENTS.md leaked the resolved project root path'
fi
if grep -Fq "$vault_root" "$agents_file"; then
  fail 'AGENTS.md leaked the resolved vault root path'
fi
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/Shopping App' "$agents_file" ||
  fail 'AGENTS.md does not use OBSIDIAN_VAULT_DIR for the wiki root'

env_project_root="$tmp_root/env-project-repo"
env_vault_root="$tmp_root/Env Obsidian Vault"
mkdir -p "$env_project_root" "$env_vault_root"

OBSIDIAN_VAULT_DIR="$env_vault_root" "$repo_dir/scripts/wiki-init-project.sh" \
  --project-root "$env_project_root" \
  "Env App"

test -f "$env_vault_root/10-Projects/Env App/00 Overview.md" ||
  fail 'OBSIDIAN_VAULT_DIR default did not create wiki docs'
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/Env App' "$env_project_root/AGENTS.md" ||
  fail 'OBSIDIAN_VAULT_DIR default was not preserved in AGENTS.md'

missing_env_project_root="$tmp_root/missing-env-project-repo"
mkdir -p "$missing_env_project_root"

if env -u OBSIDIAN_VAULT_DIR "$repo_dir/scripts/wiki-init-project.sh" \
  --project-root "$missing_env_project_root" \
  "Missing Env App" > "$tmp_root/missing-env.log" 2>&1; then
  fail 'missing OBSIDIAN_VAULT_DIR was unexpectedly accepted'
fi

grep -Fq 'OBSIDIAN_VAULT_DIR is not set' "$tmp_root/missing-env.log" ||
  fail 'missing OBSIDIAN_VAULT_DIR failure did not explain the problem'
test ! -f "$missing_env_project_root/AGENTS.md" ||
  fail 'missing OBSIDIAN_VAULT_DIR still created AGENTS.md'

agents_only_placeholder_project_root="$tmp_root/agents-only-placeholder-project-repo"
mkdir -p "$agents_only_placeholder_project_root"

OBSIDIAN_VAULT_DIR="/path/to/Obsidian Vault" "$repo_dir/scripts/wiki-init-project.sh" \
  --agents-only \
  --project-root "$agents_only_placeholder_project_root" \
  "Placeholder App"

test -f "$agents_only_placeholder_project_root/AGENTS.md" ||
  fail '--agents-only with a placeholder OBSIDIAN_VAULT_DIR did not create AGENTS.md'
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/Placeholder App' "$agents_only_placeholder_project_root/AGENTS.md" ||
  fail '--agents-only with a placeholder OBSIDIAN_VAULT_DIR did not preserve the variable reference'

bad_project_root="$tmp_root/bad-project-repo"
bad_vault_root="$bad_project_root/vault"
mkdir -p "$bad_project_root" "$bad_vault_root"

if "$repo_dir/scripts/wiki-init-project.sh" \
  --project-root "$bad_project_root" \
  --vault-root "$bad_vault_root" \
  "Bad Project" > "$tmp_root/bad-vault.log" 2>&1; then
  fail 'repo-internal vault root was unexpectedly accepted'
fi

grep -Fq 'Vault root must not be inside the project repository' "$tmp_root/bad-vault.log" ||
  fail 'repo-internal vault root rejection did not explain the problem'
test ! -f "$bad_project_root/AGENTS.md" ||
  fail 'repo-internal vault rejection still created AGENTS.md'
test ! -e "$bad_vault_root/10-Projects/Bad Project" ||
  fail 'repo-internal vault rejection still created wiki docs'

existing_agents_project_root="$tmp_root/existing-agents-project-repo"
existing_agents_vault_root="$tmp_root/Existing Agents Obsidian Vault"
mkdir -p "$existing_agents_project_root" "$existing_agents_vault_root"
cat > "$existing_agents_project_root/AGENTS.md" <<'EXISTING'
# Existing Agent Rules

Keep this project-specific rule.
EXISTING

"$repo_dir/scripts/wiki-init-project.sh" \
  --agents-only \
  --project-root "$existing_agents_project_root" \
  --vault-root "$existing_agents_vault_root" \
  "Existing Agents App"

grep -Fq 'Keep this project-specific rule.' "$existing_agents_project_root/AGENTS.md" ||
  fail 'existing AGENTS.md content was not preserved'
grep -Fq '## Project Wiki Mode' "$existing_agents_project_root/AGENTS.md" ||
  fail 'Project Wiki Mode section was not appended to an existing AGENTS.md'
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/Existing Agents App' "$existing_agents_project_root/AGENTS.md" ||
  fail 'existing AGENTS.md did not receive the correct wiki root'

"$repo_dir/scripts/wiki-init-project.sh" \
  --agents-only \
  --project-root "$existing_agents_project_root" \
  --vault-root "$existing_agents_vault_root" \
  "Existing Agents App"

project_wiki_mode_count="$(grep -Fc '## Project Wiki Mode' "$existing_agents_project_root/AGENTS.md")"
test "$project_wiki_mode_count" -eq 1 ||
  fail 're-running wiki init duplicated the Project Wiki Mode section'

public_project_root="$tmp_root/public-project-repo"
public_vault_root="$tmp_root/Public Obsidian Vault"
mkdir -p "$public_project_root" "$public_vault_root"

"$repo_dir/scripts/wiki-init-project.sh" \
  --force \
  --public \
  --project-root "$public_project_root" \
  --vault-root "$public_vault_root" \
  "Public App"

grep -Fq 'visibility: public' "$public_vault_root/10-Projects/Public App/00 Overview.md" ||
  fail '--public did not add public frontmatter to starter docs'

agents_only_project_root="$tmp_root/agents-only-project-repo"
agents_only_vault_root="$tmp_root/Agents Only Obsidian Vault"
mkdir -p "$agents_only_project_root" "$agents_only_vault_root"

"$repo_dir/scripts/wiki-init-project.sh" \
  --agents-only \
  --project-root "$agents_only_project_root" \
  --vault-root "$agents_only_vault_root" \
  "Existing App"

test -f "$agents_only_project_root/AGENTS.md" ||
  fail '--agents-only did not create AGENTS.md'
test ! -e "$agents_only_vault_root/10-Projects/Existing App/00 Overview.md" ||
  fail '--agents-only unexpectedly created starter wiki docs'

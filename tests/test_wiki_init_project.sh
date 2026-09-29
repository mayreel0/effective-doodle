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
grep -Fq '### Automatic Private Knowledge Capture' "$agents_file" ||
  fail 'normal development does not trigger private knowledge capture'
grep -Fq 'No separate wiki-mode request is required' "$agents_file" ||
  fail 'automatic capture still requires a wiki-mode request'
grep -Fq 'durable decisions and their rationale' "$agents_file" ||
  fail 'capture guidance does not identify durable decisions'
grep -Fq 'If no reusable knowledge emerged, write no note' "$agents_file" ||
  fail 'routine work would create unnecessary notes'
grep -Fq 'distinguish confirmed facts from inferences' "$agents_file" ||
  fail 'capture guidance does not distinguish evidence from inference'
grep -Fq 'report that capture did not occur' "$agents_file" ||
  fail 'capture failure would be reported as success'
grep -Fq 'managed_by: llm-agent' "$agents_file" ||
  fail 'new notes lack an agent ownership marker'
grep -Fq 'llm_content_sha256' "$agents_file" ||
  fail 'new notes lack the DEV-89 integrity marker'
grep -Fq 'If the topic path already exists, do not overwrite it' "$agents_file" ||
  fail 'existing human or agent notes could be overwritten'
grep -Fq 'only if durable knowledge would have been saved' "$agents_file" ||
  fail 'missing Vault may be reported for routine tasks'
if grep -Fq 'When the user says "위키 모드"' "$agents_file"; then
  fail 'generated AGENTS.md still gates all wiki behavior on an explicit request'
fi

local_block_project_root="$tmp_root/local-block-project-repo"
mkdir -p "$local_block_project_root"
"$repo_dir/scripts/wiki-init-project.sh" --agents-only \
  --project-root "$local_block_project_root" 'LLM Markdown Wiki System' > /dev/null
sed -n '/^<!-- project-wiki-mode:start -->$/,/^<!-- project-wiki-mode:end -->$/p' \
  "$local_block_project_root/AGENTS.md" > "$tmp_root/generated-block.md"
sed -n '/^<!-- project-wiki-mode:start -->$/,/^<!-- project-wiki-mode:end -->$/p' \
  "$repo_dir/AGENTS.md" > "$tmp_root/local-block.md"
test -s "$tmp_root/generated-block.md" && test -s "$tmp_root/local-block.md" ||
  fail 'managed block extraction was empty'
cmp -s "$tmp_root/generated-block.md" "$tmp_root/local-block.md" ||
  fail 'local and generated managed AGENTS blocks diverged'

upgrade_project_root="$tmp_root/upgrade-project-repo"
mkdir -p "$upgrade_project_root"
printf '%s\n' '<!-- project-wiki-mode:start -->' '## Project Wiki Mode' \
  'When the user says "위키 모드", follow these rules.' \
  '<!-- project-wiki-mode:end -->' '' '## User Rule' \
  'Preserve this exact user rule.' > "$upgrade_project_root/AGENTS.md"
"$repo_dir/scripts/wiki-init-project.sh" --agents-only \
  --project-root "$upgrade_project_root" 'Upgrade App' > /dev/null
"$repo_dir/scripts/wiki-init-project.sh" --agents-only \
  --project-root "$upgrade_project_root" 'Upgrade App' > /dev/null
grep -Fq '### Automatic Private Knowledge Capture' "$upgrade_project_root/AGENTS.md" ||
  fail 'old managed block was not upgraded'
if grep -Fq 'When the user says "위키 모드"' "$upgrade_project_root/AGENTS.md"; then
  fail 'old explicit-trigger guidance remains after upgrade'
fi
test "$(grep -Fc '<!-- project-wiki-mode:start -->' "$upgrade_project_root/AGENTS.md")" -eq 1 ||
  fail 'upgrading duplicated the managed block'
test "$(grep -Fc 'Preserve this exact user rule.' "$upgrade_project_root/AGENTS.md")" -eq 1 ||
  fail 'upgrading changed the user-owned rule'

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

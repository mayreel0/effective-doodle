#!/usr/bin/env bash
set -euo pipefail

required_paths=(
  "vault/index.md"
  "vault/00-Inbox"
  "vault/10-Projects"
  "vault/20-Areas"
  "vault/30-Resources"
  "vault/40-Archive"
  "vault/_llm/drafts"
  "vault/_llm/indexes"
  "vault/_llm/logs"
  "vault/_llm/proposed-edits"
  "config/syncthing/stignore.example"
  ".gitignore"
)

for path in "${required_paths[@]}"; do
  test -e "$path" || {
    echo "Missing required path: $path" >&2
    exit 1
  }
done

grep -qxF ".obsidian/workspace*" config/syncthing/stignore.example
grep -qxF ".stversions/" config/syncthing/stignore.example
if grep -qxF "*.sync-conflict-*.md" config/syncthing/stignore.example; then
  echo "Conflict files must not be ignored; they must be reported." >&2
  exit 1
fi

# Contract-presence checks only; DEV-93 must exercise an agent and real Vault behavior.
policy=docs/operations/llm-agent-policy.md
guide=docs/operations/project-wiki-mode.md
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/<Project Name>/_llm/knowledge/<stable-topic>.md' "$policy"
grep -Fiq 'human-authored' "$policy"
grep -Fq 'do not add `visibility: public`' "$policy"
grep -Fq 'managed_by: llm-agent' "$policy"
grep -Fq 'llm_content_sha256' "$policy"
grep -Fq 'recomputed `llm_content_sha256`' "$policy"
grep -Fq 'made manually public' "$policy"
grep -Fq 'raw secrets' "$policy"
grep -Fq 'unavailable or unwritable' "$policy"
grep -Fq 'Do not overwrite human edits' "$policy"
grep -Fq 'atomic replacement' "$policy"
grep -Fq 'realpath' "$policy"
grep -Fq 'report that knowledge capture did not occur' "$policy"
grep -Fq 'Never use the source repository as a fallback' "$policy"
grep -Fq '_llm/knowledge/' "$guide"
grep -Fq 'managed_by: llm-agent' "$guide"
grep -Fq 'raw secrets' "$guide"
grep -Fq 'Do not fall back' "$guide"

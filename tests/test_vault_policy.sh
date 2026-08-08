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

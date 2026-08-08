#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

# shellcheck source=scripts/lib/wiki-env.sh
source "$repo_dir/scripts/lib/wiki-env.sh"
load_wiki_env "${1:-/etc/wiki/wiki.env}"

if [ ! -d "$WIKI_VAULT_DIR" ]; then
  echo "Vault directory does not exist: $WIKI_VAULT_DIR" >&2
  exit 1
fi

if ! conflict_output="$(find "$WIKI_VAULT_DIR" -type f -name '*.sync-conflict-*.md' | sort)"; then
  echo "Failed to scan vault for Syncthing Markdown conflicts." >&2
  exit 1
fi

conflicts=()
if [ -n "$conflict_output" ]; then
  while IFS= read -r conflict; do
    conflicts+=("$conflict")
  done <<< "$conflict_output"
fi

if [ "${#conflicts[@]}" -eq 0 ]; then
  echo "No Syncthing Markdown conflicts found."
  exit 0
fi

echo "Syncthing Markdown conflicts found:"
printf '%s\n' "${conflicts[@]}"
exit 2

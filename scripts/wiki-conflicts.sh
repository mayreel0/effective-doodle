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

conflicts=()
while IFS= read -r conflict; do
  conflicts+=("$conflict")
done < <(find "$WIKI_VAULT_DIR" -type f -name '*.sync-conflict-*.md' | sort)

if [ "${#conflicts[@]}" -eq 0 ]; then
  echo "No Syncthing Markdown conflicts found."
  exit 0
fi

echo "Syncthing Markdown conflicts found:"
printf '%s\n' "${conflicts[@]}"
exit 2

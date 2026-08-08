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

mkdir -p "$tmp_root/vault" "$tmp_root/bin"
printf '%s\n' \
  "WIKI_VAULT_DIR=$tmp_root/vault" \
  "WIKI_QUARTZ_DIR=$tmp_root/quartz" \
  "WIKI_PUBLIC_DIR=$tmp_root/public" \
  "WIKI_BUILD_TMP_DIR=$tmp_root/public.next" \
  'WIKI_GIT_REMOTE=origin' \
  'WIKI_GIT_BRANCH=main' > "$tmp_root/wiki.env"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  "echo 'forced find failure' >&2" \
  'exit 42' > "$tmp_root/bin/find"
chmod +x "$tmp_root/bin/find"

if PATH="$tmp_root/bin:$PATH" \
  "$repo_dir/scripts/wiki-conflicts.sh" "$tmp_root/wiki.env" \
  > "$tmp_root/output.log" 2>&1; then
  fail 'conflict scan unexpectedly succeeded when find failed'
fi

grep -q 'Failed to scan vault for Syncthing Markdown conflicts.' "$tmp_root/output.log" ||
  fail 'conflict scan did not report the traversal failure'
if grep -q 'No Syncthing Markdown conflicts found.' "$tmp_root/output.log"; then
  fail 'conflict scan reported false clean output after traversal failure'
fi

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

write_env() {
  local env_file="$1"
  local vault_dir="$2"
  local branch="$3"

  printf '%s\n' \
    "WIKI_VAULT_DIR=$vault_dir" \
    "WIKI_QUARTZ_DIR=$tmp_root/quartz" \
    "WIKI_PUBLIC_DIR=$tmp_root/public" \
    "WIKI_BUILD_TMP_DIR=$tmp_root/public.next" \
    'WIKI_GIT_REMOTE=origin' \
    "WIKI_GIT_BRANCH=$branch" > "$env_file"
}

mismatch_root="$tmp_root/mismatch"
mkdir -p "$mismatch_root/vault"
git -C "$mismatch_root/vault" init -q -b feature
git -C "$mismatch_root/vault" config user.email wiki@example.local
git -C "$mismatch_root/vault" config user.name 'Wiki Snapshot'
printf '%s\n' 'uncommitted note' > "$mismatch_root/vault/note.md"
write_env "$mismatch_root/wiki.env" "$mismatch_root/vault" main

if "$repo_dir/scripts/wiki-snapshot.sh" "$mismatch_root/wiki.env" \
  > "$mismatch_root/output.log" 2>&1; then
  fail 'snapshot unexpectedly succeeded on the wrong branch'
fi

grep -q "current branch is 'feature'" "$mismatch_root/output.log" ||
  fail 'branch mismatch did not identify the current branch'
grep -q "expected WIKI_GIT_BRANCH 'main'" "$mismatch_root/output.log" ||
  fail 'branch mismatch did not identify the configured branch'
if git -C "$mismatch_root/vault" rev-parse --verify HEAD >/dev/null 2>&1; then
  fail 'branch mismatch created a snapshot commit'
fi

matching_root="$tmp_root/matching"
mkdir -p "$matching_root/vault"
git -C "$matching_root/vault" init -q -b main
git -C "$matching_root/vault" config user.email wiki@example.local
git -C "$matching_root/vault" config user.name 'Wiki Snapshot'
printf '%s\n' 'new note' > "$matching_root/vault/note.md"
write_env "$matching_root/wiki.env" "$matching_root/vault" main

"$repo_dir/scripts/wiki-snapshot.sh" "$matching_root/wiki.env" \
  > "$matching_root/output.log" 2>&1

test "$(git -C "$matching_root/vault" log -1 --format=%s)" != '' ||
  fail 'matching branch did not create a snapshot commit'
grep -q "Remote 'origin' is not configured; skipping push." "$matching_root/output.log" ||
  fail 'missing remote did not produce the documented skip message'

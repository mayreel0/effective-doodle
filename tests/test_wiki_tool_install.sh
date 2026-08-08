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

bin_dir="$tmp_root/bin"
project_root="$tmp_root/another-project"

mkdir -p "$project_root"

"$repo_dir/scripts/install-wiki-tools.sh" --bin-dir "$bin_dir" > "$tmp_root/install.log"

test -L "$bin_dir/wiki-init-project" ||
  fail 'wiki-init-project command was not installed as a symlink'
test -x "$bin_dir/wiki-init-project" ||
  fail 'installed wiki-init-project command is not executable'

(
  cd "$project_root"
  PATH="$bin_dir:$PATH" wiki-init-project --agents-only "Another Project"
)

test -f "$project_root/AGENTS.md" ||
  fail 'global wiki-init-project did not create AGENTS.md in the current project'
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/Another Project' "$project_root/AGENTS.md" ||
  fail 'global wiki-init-project did not generate a reusable OBSIDIAN_VAULT_DIR wiki root'
if grep -Fq "$repo_dir" "$project_root/AGENTS.md"; then
  fail 'global wiki-init-project leaked the wiki tools repository path into AGENTS.md'
fi

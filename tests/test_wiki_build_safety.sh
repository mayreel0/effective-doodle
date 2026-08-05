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

create_fixture() {
  local root="$1"

  mkdir -p "$root/vault" "$root/quartz/content" "$root/public" "$root/bin"
  printf '%s\n' '{}' > "$root/quartz/package.json"
  printf '%s\n' 'vault source' > "$root/vault/note.md"
  printf '%s\n' 'existing Quartz content' > "$root/quartz/content/keep.txt"
  printf '%s\n' 'existing public output' > "$root/public/index.html"
}

write_env() {
  local env_file="$1"
  local vault_dir="$2"
  local quartz_dir="$3"
  local public_dir="$4"
  local build_tmp_dir="$5"

  printf '%s\n' \
    "WIKI_VAULT_DIR=$vault_dir" \
    "WIKI_QUARTZ_DIR=$quartz_dir" \
    "WIKI_PUBLIC_DIR=$public_dir" \
    "WIKI_BUILD_TMP_DIR=$build_tmp_dir" \
    'WIKI_GIT_REMOTE=origin' \
    'WIKI_GIT_BRANCH=main' > "$env_file"
}

run_rejection_case() {
  local name="$1"
  local vault_dir="$2"
  local quartz_dir="$3"
  local public_dir="$4"
  local build_tmp_dir="$5"
  local env_file="$6"
  local output_file="$7"

  write_env "$env_file" "$vault_dir" "$quartz_dir" "$public_dir" "$build_tmp_dir"
  if PATH="$tmp_root/failed-build/bin:$PATH" "$repo_dir/scripts/wiki-build.sh" "$env_file" > "$output_file" 2>&1; then
    fail "$name: expected configured-path validation to fail"
  fi

  grep -q 'Unsafe overlapping build directories' "$output_file" ||
    fail "$name: expected configured-path validation error"
  test -f "$quartz_dir/content/keep.txt" ||
    fail "$name: validation ran after Quartz content was deleted"
}

failed_build_root="$tmp_root/failed-build"
create_fixture "$failed_build_root"
cat > "$failed_build_root/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$failed_build_root/bin/npx" <<'SCRIPT'
#!/usr/bin/env bash
touch "$FIXTURE_ROOT/npx-called"
exit 1
SCRIPT
chmod +x "$failed_build_root/bin/npm" "$failed_build_root/bin/npx"

write_env \
  "$failed_build_root/wiki.env" \
  "$failed_build_root/vault" \
  "$failed_build_root/quartz" \
  "$failed_build_root/public" \
  "$failed_build_root/public.next"

if FIXTURE_ROOT="$failed_build_root" PATH="$failed_build_root/bin:$PATH" \
  "$repo_dir/scripts/wiki-build.sh" "$failed_build_root/wiki.env" \
  > "$failed_build_root/failed-build.log" 2>&1; then
  fail 'failed Quartz build unexpectedly succeeded'
fi

test -f "$failed_build_root/npx-called" ||
  fail 'failed Quartz build did not reach npx'
test "$(cat "$failed_build_root/public/index.html")" = 'existing public output' ||
  fail 'failed Quartz build changed existing public output'

same_path_root="$tmp_root/same-path"
create_fixture "$same_path_root"
run_rejection_case \
  'build temp equals public output' \
  "$same_path_root/vault" \
  "$same_path_root/quartz" \
  "$same_path_root/public" \
  "$same_path_root/public" \
  "$same_path_root/wiki.env" \
  "$same_path_root/output.log"

vault_public_root="$tmp_root/vault-public"
create_fixture "$vault_public_root"
run_rejection_case \
  'public output equals vault' \
  "$vault_public_root/vault" \
  "$vault_public_root/quartz" \
  "$vault_public_root/vault" \
  "$vault_public_root/public.next" \
  "$vault_public_root/wiki.env" \
  "$vault_public_root/output.log"

nested_path_root="$tmp_root/nested-path"
create_fixture "$nested_path_root"
run_rejection_case \
  'build temp is inside public output' \
  "$nested_path_root/vault" \
  "$nested_path_root/quartz" \
  "$nested_path_root/public" \
  "$nested_path_root/public/staging" \
  "$nested_path_root/wiki.env" \
  "$nested_path_root/output.log"

symlink_path_root="$tmp_root/symlink-path"
create_fixture "$symlink_path_root"
ln -s "$symlink_path_root/public" "$symlink_path_root/public-alias"
run_rejection_case \
  'build temp aliases public output' \
  "$symlink_path_root/vault" \
  "$symlink_path_root/quartz" \
  "$symlink_path_root/public" \
  "$symlink_path_root/public-alias" \
  "$symlink_path_root/wiki.env" \
  "$symlink_path_root/output.log"

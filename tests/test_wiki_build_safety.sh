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

  mkdir -p "$root/vault" "$root/quartz/content" "$root/public" "$root/private" "$root/bin"
  printf '%s\n' '{}' > "$root/quartz/package.json"
  printf '%s\n' 'vault source' > "$root/vault/note.md"
  printf '%s\n' 'existing Quartz content' > "$root/quartz/content/keep.txt"
  printf '%s\n' 'existing public output' > "$root/public/index.html"
  printf '%s\n' 'existing private output' > "$root/private/index.html"
}

write_env() {
  local env_file="$1"
  local vault_dir="$2"
  local quartz_dir="$3"
  local public_dir="$4"
  local build_tmp_dir="$5"
  local state_dir="${6:-}"
  local private_dir="${7:-$(dirname "$public_dir")/private}"
  local private_build_tmp_dir="${8:-${private_dir}.next}"

  printf '%s\n' \
    "WIKI_VAULT_DIR=$vault_dir" \
    "WIKI_QUARTZ_DIR=$quartz_dir" \
    "WIKI_PUBLIC_DIR=$public_dir" \
    "WIKI_BUILD_TMP_DIR=$build_tmp_dir" \
    "WIKI_PRIVATE_DIR=$private_dir" \
    "WIKI_PRIVATE_BUILD_TMP_DIR=$private_build_tmp_dir" \
    'WIKI_GIT_REMOTE=origin' \
    'WIKI_GIT_BRANCH=main' > "$env_file"

  if [ -n "$state_dir" ]; then
    printf '%s\n' "WIKI_BUILD_STATE_DIR=$state_dir" >> "$env_file"
  fi
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

promotion_root="$tmp_root/promotion-failure"
create_fixture "$promotion_root"
real_mv="$(command -v mv)"
cat > "$promotion_root/bin/rsync" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$promotion_root/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$promotion_root/bin/npx" <<'SCRIPT'
#!/usr/bin/env bash
test -f "$FIXTURE_ROOT/quartz/content/_system/wiki-build-status.md" ||
  exit 71
output_dir="${@: -1}"
printf '%s\n' "new output for $output_dir" > "$output_dir/index.html"
SCRIPT
cat > "$promotion_root/bin/mv" <<'SCRIPT'
#!/usr/bin/env bash
case "$1:$2" in
  */public.next:*/public)
    echo 'forced final promotion failure' >&2
    exit 73
    ;;
esac
exec "$REAL_MV" "$@"
SCRIPT
chmod +x \
  "$promotion_root/bin/rsync" \
  "$promotion_root/bin/npm" \
  "$promotion_root/bin/npx" \
  "$promotion_root/bin/mv"

write_env \
  "$promotion_root/wiki.env" \
  "$promotion_root/vault" \
  "$promotion_root/quartz" \
  "$promotion_root/public" \
  "$promotion_root/public.next"

if FIXTURE_ROOT="$promotion_root" REAL_MV="$real_mv" PATH="$promotion_root/bin:$PATH" \
  "$repo_dir/scripts/wiki-build.sh" "$promotion_root/wiki.env" \
  > "$promotion_root/output.log" 2>&1; then
  fail 'failed final promotion unexpectedly succeeded'
fi

test -f "$promotion_root/public/index.html" ||
  fail 'failed final promotion did not restore the previous public site'
test "$(cat "$promotion_root/public/index.html")" = 'existing public output' ||
  fail 'failed final promotion restored the wrong public content'
grep -q 'Restored previous public site after promotion failure.' "$promotion_root/output.log" ||
  fail 'failed final promotion did not report successful rollback'

skip_root="$tmp_root/skip-unchanged"
create_fixture "$skip_root"
cat > "$skip_root/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$skip_root/bin/npx" <<'SCRIPT'
#!/usr/bin/env bash
output_dir="${@: -1}"
printf '%s\n' "new output for $output_dir" > "$output_dir/index.html"
SCRIPT
chmod +x "$skip_root/bin/npm" "$skip_root/bin/npx"

write_env \
  "$skip_root/wiki.env" \
  "$skip_root/vault" \
  "$skip_root/quartz" \
  "$skip_root/public" \
  "$skip_root/public.next" \
  "$skip_root/state"

FIXTURE_ROOT="$skip_root" PATH="$skip_root/bin:$PATH" \
  "$repo_dir/scripts/wiki-build.sh" "$skip_root/wiki.env" \
  > "$skip_root/first.log" 2>&1 ||
  fail 'initial unchanged-skip fixture build failed'

cat > "$skip_root/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
echo 'npm should not run for unchanged Markdown' >&2
exit 81
SCRIPT
cat > "$skip_root/bin/npx" <<'SCRIPT'
#!/usr/bin/env bash
echo 'npx should not run for unchanged Markdown' >&2
exit 82
SCRIPT
chmod +x "$skip_root/bin/npm" "$skip_root/bin/npx"

FIXTURE_ROOT="$skip_root" PATH="$skip_root/bin:$PATH" \
  "$repo_dir/scripts/wiki-build.sh" "$skip_root/wiki.env" \
  > "$skip_root/second.log" 2>&1 ||
  fail 'unchanged Markdown build should have skipped successfully'

grep -q 'No Markdown changes detected; skipping Quartz build.' "$skip_root/second.log" ||
  fail 'unchanged Markdown run did not report a skipped build'

visibility_root="$tmp_root/visibility-split"
create_fixture "$visibility_root"
mkdir -p "$visibility_root/vault/projects" "$visibility_root/vault/_public_assets"
cat > "$visibility_root/vault/projects/public-note.md" <<'MARKDOWN'
---
visibility: public
---

Public note
MARKDOWN
cat > "$visibility_root/vault/projects/private-note.md" <<'MARKDOWN'
---
visibility: private
---

Private note
MARKDOWN
printf '%s\n' 'public asset' > "$visibility_root/vault/_public_assets/readme.txt"
cat > "$visibility_root/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$visibility_root/bin/npx" <<'SCRIPT'
#!/usr/bin/env bash
output_dir="${@: -1}"
mkdir -p "$output_dir"
case "$output_dir" in
  */private.next)
  test -f "$FIXTURE_ROOT/quartz/content/projects/public-note.md" || exit 91
  test -f "$FIXTURE_ROOT/quartz/content/projects/private-note.md" || exit 92
  ;;
  *)
  test -f "$FIXTURE_ROOT/quartz/content/index.md" || exit 90
  test -f "$FIXTURE_ROOT/quartz/content/projects/public-note.md" || exit 93
  test ! -f "$FIXTURE_ROOT/quartz/content/projects/private-note.md" || exit 94
  test -f "$FIXTURE_ROOT/quartz/content/_public_assets/readme.txt" || exit 95
  ;;
esac
printf '%s\n' "new output for $output_dir" > "$output_dir/index.html"
SCRIPT
chmod +x "$visibility_root/bin/npm" "$visibility_root/bin/npx"

write_env \
  "$visibility_root/wiki.env" \
  "$visibility_root/vault" \
  "$visibility_root/quartz" \
  "$visibility_root/public" \
  "$visibility_root/public.next" \
  "$visibility_root/state" \
  "$visibility_root/private" \
  "$visibility_root/private.next"

FIXTURE_ROOT="$visibility_root" PATH="$visibility_root/bin:$PATH" \
  "$repo_dir/scripts/wiki-build.sh" "$visibility_root/wiki.env" \
  > "$visibility_root/output.log" 2>&1 ||
  fail 'visibility split build failed'

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

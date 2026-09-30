#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fail() {
  echo "$1" >&2
  exit 1
}

project_dir="$fixture_root/project"
vault_dir="$fixture_root/vault"
quartz_dir="$fixture_root/quartz"
wiki_dir="$vault_dir/10-Projects/Synthetic Project"
note_dir="$wiki_dir/_llm/knowledge"
mkdir -p "$project_dir" "$vault_dir" "$quartz_dir/content" "$fixture_root/bin"
git -C "$project_dir" init -q
printf '%s\n' 'export const answer = 42;' > "$project_dir/index.js"
git -C "$project_dir" add index.js
git -C "$project_dir" -c user.name=Fixture -c user.email=fixture@example.com commit -qm initial

# 한국어: 생성된 지침은 저장소에, 지식 문서는 저장소 밖의 임시 Vault에 둔다.
"$repo_dir/scripts/wiki-init-project.sh" \
  --project-root "$project_dir" --vault-root "$vault_dir" 'Synthetic Project' \
  > "$fixture_root/init.log"
test -f "$project_dir/AGENTS.md" || fail 'generated AGENTS.md is missing'
grep -q 'Automatic Private Knowledge Capture' "$project_dir/AGENTS.md" ||
  fail 'generated AGENTS.md lacks automatic capture guidance'
grep -q 'Selective Advisory Reuse' "$project_dir/AGENTS.md" ||
  fail 'generated AGENTS.md lacks selective reuse guidance'
grep -Fq '${OBSIDIAN_VAULT_DIR}/10-Projects/Synthetic Project/_llm/knowledge/' "$project_dir/AGENTS.md" ||
  fail 'generated AGENTS.md points capture to the wrong location'
test ! -d "$project_dir/_llm" || fail 'knowledge directory was created in source repository'

git -C "$project_dir" add AGENTS.md
git -C "$project_dir" -c user.name=Fixture -c user.email=fixture@example.com commit -qm instructions

mkdir -p "$note_dir"
note_path="$note_dir/source-of-truth.md"
cat > "$note_path" <<'NOTE'
---
managed_by: llm-agent
---

# Source of truth

Confirmed: current source code takes priority over this note.
Synthetic private marker: SYNTHETIC_SECRET_DO_NOT_PUBLISH.
NOTE
if command -v sha256sum >/dev/null 2>&1; then
  digest="$(sha256sum "$note_path" | awk '{print $1}')"
else
  digest="$(shasum -a 256 "$note_path" | awk '{print $1}')"
fi
awk -v digest="$digest" '
  /^managed_by: llm-agent$/ { print; print "llm_content_sha256: " digest; next }
  { print }
' "$note_path" > "$note_path.next"
mv "$note_path.next" "$note_path"

printf '%s\n' '{}' > "$quartz_dir/package.json"
cat > "$fixture_root/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$fixture_root/bin/npx" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
test "$#" -eq 4 && test "$1" = quartz && test "$2" = build && test "$3" = --output ||
  exit 2
output_dir="$4"
mkdir -p "$output_dir"
while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$WIKI_QUARTZ_DIR/content/"}"
  target_file="$output_dir/${relative_path%.md}.html"
  mkdir -p "$(dirname "$target_file")"
  cp "$source_file" "$target_file"
done < <(find "$WIKI_QUARTZ_DIR/content" -type f -name '*.md' -print0)
test -f "$output_dir/index.html" || printf '%s\n' 'fixture index' > "$output_dir/index.html"
SCRIPT
chmod +x "$fixture_root/bin/npm" "$fixture_root/bin/npx"

cat > "$fixture_root/wiki.env" <<ENV
WIKI_VAULT_DIR=$vault_dir
WIKI_QUARTZ_DIR=$quartz_dir
WIKI_PUBLIC_DIR=$fixture_root/public
WIKI_BUILD_TMP_DIR=$fixture_root/public.next
WIKI_PRIVATE_DIR=$fixture_root/private
WIKI_PRIVATE_BUILD_TMP_DIR=$fixture_root/private.next
WIKI_BUILD_STATE_DIR=$fixture_root/state
WIKI_GIT_REMOTE=origin
WIKI_GIT_BRANCH=main
ENV

run_build() {
  PATH="$fixture_root/bin:$PATH" \
    "$repo_dir/scripts/wiki-build.sh" "$fixture_root/wiki.env" \
    > "$fixture_root/build.log" 2>&1 || {
      sed -n '1,60p' "$fixture_root/build.log" >&2
      fail 'wiki build failed'
    }
}

# 한국어: 비공개 생성 노트는 비공개 결과물에만 포함되고 공개 결과물에는 없어야 한다.
run_build
relative_note='10-Projects/Synthetic Project/_llm/knowledge/source-of-truth.html'
test -f "$fixture_root/private/$relative_note" || fail 'private output lacks captured note'
test ! -e "$fixture_root/public/$relative_note" || fail 'private note appeared in public output'
grep -q '^llm_content_sha256:' "$fixture_root/private/$relative_note" ||
  fail 'private output lacks agent ownership digest'
test -d "$fixture_root/public" || fail 'public output is missing'
if grep -R -q -e 'SYNTHETIC_SECRET_DO_NOT_PUBLISH' "$fixture_root/public"; then
  fail 'synthetic private marker leaked into public output'
else
  test "$?" -eq 1 || fail 'could not inspect public output for private marker'
fi

# 한국어: 사람의 명시적 공개 전환 이후에만 같은 노트가 공개 결과물에 포함된다.
cat > "$note_path" <<'NOTE'
---
visibility: public
---

# Source of truth

Confirmed: current source code takes priority over this note.
NOTE
run_build
test -f "$fixture_root/public/$relative_note" || fail 'manually public note is absent'
test -f "$fixture_root/private/$relative_note" || fail 'private output lost the public note'
grep -q 'current source code takes priority' "$fixture_root/public/$relative_note" ||
  fail 'public output has the wrong note content'
test ! -e "$project_dir/_llm" || fail 'build created knowledge files in source repository'
test -z "$(git -C "$project_dir" status --porcelain --ignored)" ||
  fail 'capture or build modified the source repository'

echo 'Private knowledge end-to-end boundary tests passed.'

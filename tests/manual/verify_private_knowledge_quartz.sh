#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fail() {
  echo "$1" >&2
  exit 1
}

# Run manually: this downloads and builds the official Quartz v4 checkout.
git clone --quiet --depth 1 --branch v4 \
  https://github.com/jackyzha0/quartz.git "$fixture_root/quartz"
echo "Quartz revision: $(git -C "$fixture_root/quartz" rev-parse HEAD)"

vault_dir="$fixture_root/vault"
note_dir="$vault_dir/10-Projects/Synthetic-Project/_llm/knowledge"
mkdir -p "$note_dir"
printf '%s\n' '# Synthetic private wiki' > "$vault_dir/index.md"
note_path="$note_dir/source-of-truth.md"
cat > "$note_path" <<'NOTE'
---
title: Source of Truth
managed_by: llm-agent
---

# Source of Truth

SYNTHETIC_PRIVATE_MARKER_93
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

cat > "$fixture_root/wiki.env" <<ENV
WIKI_VAULT_DIR=$vault_dir
WIKI_QUARTZ_DIR=$fixture_root/quartz
WIKI_PUBLIC_DIR=$fixture_root/public
WIKI_BUILD_TMP_DIR=$fixture_root/public.next
WIKI_PRIVATE_DIR=$fixture_root/private
WIKI_PRIVATE_BUILD_TMP_DIR=$fixture_root/private.next
WIKI_BUILD_STATE_DIR=$fixture_root/state
WIKI_GIT_REMOTE=origin
WIKI_GIT_BRANCH=main
ENV

run_build() {
  "$repo_dir/scripts/wiki-build.sh" "$fixture_root/wiki.env" \
    > "$fixture_root/build.log" 2>&1 || {
      tail -60 "$fixture_root/build.log" >&2
      fail 'real Quartz build failed'
    }
}

# 한국어: 비공개 노트는 실제 Quartz의 비공개 산출물에만 존재한다.
run_build
private_page="$(find "$fixture_root/private" -type f -name 'source-of-truth.html' -print -quit)"
test -n "$private_page" || fail 'private Quartz output lacks the note'
test -d "$fixture_root/public" || fail 'public Quartz output is missing'
test -z "$(find "$fixture_root/public" -type f -name 'source-of-truth.html' -print -quit)" ||
  fail 'private note was rendered into public Quartz output'
if grep -R -q -e 'SYNTHETIC_PRIVATE_MARKER_93' "$fixture_root/public"; then
  fail 'private marker leaked into public Quartz output'
else
  test "$?" -eq 1 || fail 'could not inspect public Quartz output for private marker'
fi

# 한국어: 사람이 visibility를 public으로 바꾼 뒤에만 공개 산출물에 노트가 나타난다.
cat > "$note_path" <<'NOTE'
---
title: Source of Truth
visibility: public
---

# Source of Truth

SYNTHETIC_PUBLIC_MARKER_93
NOTE
run_build
public_page="$(find "$fixture_root/public" -type f -name 'source-of-truth.html' -print -quit)"
test -n "$public_page" || fail 'manually public note is absent from Quartz output'
grep -q 'SYNTHETIC_PUBLIC_MARKER_93' "$public_page" || fail 'public page has wrong content'
echo 'Real Quartz private/public boundary verification passed.'

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

if [ ! -d "$WIKI_QUARTZ_DIR" ]; then
  echo "Quartz directory does not exist: $WIKI_QUARTZ_DIR" >&2
  exit 1
fi

if [ ! -f "$WIKI_QUARTZ_DIR/package.json" ]; then
  echo "Quartz package.json not found in: $WIKI_QUARTZ_DIR" >&2
  exit 1
fi

rm -rf "$WIKI_QUARTZ_DIR/content"
mkdir -p "$WIKI_QUARTZ_DIR/content"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.obsidian/workspace*' \
  --exclude '.obsidian/cache/' \
  --exclude '.stversions/' \
  --exclude '.trash/' \
  "$WIKI_VAULT_DIR/" "$WIKI_QUARTZ_DIR/content/"

rm -rf "$WIKI_BUILD_TMP_DIR"
mkdir -p "$WIKI_BUILD_TMP_DIR"

cd "$WIKI_QUARTZ_DIR"
npm install
npx quartz build --output "$WIKI_BUILD_TMP_DIR"

if [ ! -f "$WIKI_BUILD_TMP_DIR/index.html" ]; then
  echo "Quartz build did not produce index.html" >&2
  exit 1
fi

previous_dir="${WIKI_PUBLIC_DIR}.previous"
rm -rf "$previous_dir"

if [ -d "$WIKI_PUBLIC_DIR" ]; then
  mv "$WIKI_PUBLIC_DIR" "$previous_dir"
fi

mv "$WIKI_BUILD_TMP_DIR" "$WIKI_PUBLIC_DIR"
echo "Published Quartz site to $WIKI_PUBLIC_DIR"

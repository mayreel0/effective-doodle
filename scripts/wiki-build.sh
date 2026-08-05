#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

# shellcheck source=scripts/lib/wiki-env.sh
source "$repo_dir/scripts/lib/wiki-env.sh"
load_wiki_env "${1:-/etc/wiki/wiki.env}"

canonicalize_directory() {
  local label="$1"
  local path="$2"
  local parent_dir
  local base_name

  case "$path" in
    /*) ;;
    *)
      echo "$label must be an absolute path: $path" >&2
      return 1
      ;;
  esac

  if [ -e "$path" ] || [ -L "$path" ]; then
    if [ ! -d "$path" ]; then
      echo "$label is not a directory: $path" >&2
      return 1
    fi

    (cd -P "$path" && pwd)
    return
  fi

  parent_dir="$(dirname "$path")"
  base_name="$(basename "$path")"
  if [ ! -d "$parent_dir" ]; then
    echo "$label parent directory does not exist: $parent_dir" >&2
    return 1
  fi

  (cd -P "$parent_dir" && printf '%s/%s\n' "$(pwd)" "$base_name")
}

is_same_or_descendant() {
  local ancestor="$1"
  local candidate="$2"

  [ "$ancestor" = "/" ] || [[ "$candidate" = "$ancestor" || "$candidate" = "$ancestor"/* ]]
}

paths_overlap() {
  is_same_or_descendant "$1" "$2" || is_same_or_descendant "$2" "$1"
}

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

WIKI_VAULT_DIR="$(canonicalize_directory 'Vault directory' "$WIKI_VAULT_DIR")"
WIKI_QUARTZ_DIR="$(canonicalize_directory 'Quartz directory' "$WIKI_QUARTZ_DIR")"
WIKI_PUBLIC_DIR="$(canonicalize_directory 'Public directory' "$WIKI_PUBLIC_DIR")"
WIKI_BUILD_TMP_DIR="$(canonicalize_directory 'Build temporary directory' "$WIKI_BUILD_TMP_DIR")"
previous_dir="$(canonicalize_directory 'Previous public directory' "${WIKI_PUBLIC_DIR}.previous")"

path_names=(
  'vault directory'
  'Quartz directory'
  'public directory'
  'build temporary directory'
  'previous public directory'
)
path_values=(
  "$WIKI_VAULT_DIR"
  "$WIKI_QUARTZ_DIR"
  "$WIKI_PUBLIC_DIR"
  "$WIKI_BUILD_TMP_DIR"
  "$previous_dir"
)

for ((i = 0; i < ${#path_values[@]}; i++)); do
  for ((j = i + 1; j < ${#path_values[@]}; j++)); do
    if paths_overlap "${path_values[i]}" "${path_values[j]}"; then
      echo "Unsafe overlapping build directories: ${path_names[i]} (${path_values[i]}) and ${path_names[j]} (${path_values[j]})" >&2
      exit 1
    fi
  done
done

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

rm -rf "$previous_dir"

if [ -d "$WIKI_PUBLIC_DIR" ]; then
  mv "$WIKI_PUBLIC_DIR" "$previous_dir"
fi

mv "$WIKI_BUILD_TMP_DIR" "$WIKI_PUBLIC_DIR"
echo "Published Quartz site to $WIKI_PUBLIC_DIR"

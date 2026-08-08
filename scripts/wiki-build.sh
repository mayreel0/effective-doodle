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

device_id() {
  local path="$1"
  local id

  if id="$(stat -f '%d' "$path" 2>/dev/null)"; then
    printf '%s\n' "$id"
    return
  fi

  if id="$(stat -c '%d' "$path" 2>/dev/null)"; then
    printf '%s\n' "$id"
    return
  fi

  echo "Unable to determine filesystem device for: $path" >&2
  return 1
}

hash_command() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s\n' sha256sum
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    printf '%s\n' 'shasum -a 256'
    return
  fi

  echo "sha256sum or shasum is required to fingerprint Markdown changes." >&2
  return 1
}

markdown_fingerprint() {
  local hash_cmd="$1"
  local manifest="$2"

  find "$WIKI_VAULT_DIR" -type f -name '*.md' -print0 |
    sort -z |
    while IFS= read -r -d '' file_path; do
      if stat_output="$(stat -c '%s %Y' "$file_path" 2>/dev/null)"; then
        :
      elif stat_output="$(stat -f '%z %m' "$file_path" 2>/dev/null)"; then
        :
      else
        echo "Unable to stat Markdown file: $file_path" >&2
        return 1
      fi

      relative_path="${file_path#"$WIKI_VAULT_DIR"/}"
      printf '%s %s\n' "$stat_output" "$relative_path"
    done > "$manifest"

  # shellcheck disable=SC2086
  $hash_cmd "$manifest" | awk '{print $1}'
}

is_public_markdown() {
  local file_path="$1"

  awk '
    BEGIN { found = 0; status = 1 }
    NR == 1 {
      if ($0 != "---") {
        exit status
      }
      next
    }
    $0 == "---" {
      status = found ? 0 : 1
      exit status
    }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      sub(/[[:space:]]*$/, "", line)
      gsub(/["\047]/, "", line)
      if (line == "visibility: public") {
        found = 1
      }
    }
    END { exit status }
  ' "$file_path"
}

build_status_values() {
  WIKI_STATUS_BUILT_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  WIKI_STATUS_SOURCE_FILES="$(find "$WIKI_VAULT_DIR" -type f -name '*.md' | wc -l | tr -d ' ')"
  WIKI_STATUS_SOURCE_DIRS="$(find "$WIKI_VAULT_DIR" -type d | wc -l | tr -d ' ')"
}

write_build_status_markdown() {
  local content_dir="$1"
  local status_dir="$content_dir/_system"

  mkdir -p "$status_dir"
  cat > "$status_dir/wiki-build-status.md" <<MARKDOWN
---
title: Wiki Build Status
tags:
  - wiki/system
  - wiki/status
---

# Wiki Build Status

| Field | Value |
| --- | --- |
| Status | ok |
| Last successful build UTC | \`$WIKI_STATUS_BUILT_AT\` |
| Schedule | \`wiki-build.timer OnCalendar=*:0/10\` |
| Markdown files | $WIKI_STATUS_SOURCE_FILES |
| Directories | $WIKI_STATUS_SOURCE_DIRS |
| Vault | \`$WIKI_VAULT_DIR\` |
| Quartz | \`$WIKI_QUARTZ_DIR\` |
| Public output | \`$WIKI_PUBLIC_DIR\` |

This page is generated during the wiki build. If the timestamp changes, the Quartz publish pipeline completed successfully.
MARKDOWN
}

write_public_index_markdown() {
  local content_dir="$1"

  cat > "$content_dir/index.md" <<MARKDOWN
---
title: Public Wiki
---

# Public Wiki

This public wiki only includes Markdown files with \`visibility: public\` in frontmatter.

Last successful source scan UTC: \`$WIKI_STATUS_BUILT_AT\`
MARKDOWN
}

write_build_status() {
  local output_dir="$1"

  cat > "$output_dir/_wiki-status.json" <<JSON
{
  "status": "ok",
  "built_at_utc": "$WIKI_STATUS_BUILT_AT",
  "build_schedule": "systemd wiki-build.timer OnCalendar=*:0/10",
  "vault_dir": "$WIKI_VAULT_DIR",
  "quartz_dir": "$WIKI_QUARTZ_DIR",
  "public_dir": "$WIKI_PUBLIC_DIR",
  "markdown_files": $WIKI_STATUS_SOURCE_FILES,
  "directories": $WIKI_STATUS_SOURCE_DIRS
}
JSON

  cat > "$output_dir/_wiki-status.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wiki Build Status</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 48rem; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #ddd; padding: 0.6rem; text-align: left; }
    code { background: #f4f4f4; padding: 0.1rem 0.25rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Wiki Build Status</h1>
  <table>
    <tr><th>Status</th><td>ok</td></tr>
    <tr><th>Last successful build UTC</th><td><code>$WIKI_STATUS_BUILT_AT</code></td></tr>
    <tr><th>Schedule</th><td><code>wiki-build.timer OnCalendar=*:0/10</code></td></tr>
    <tr><th>Markdown files</th><td>$WIKI_STATUS_SOURCE_FILES</td></tr>
    <tr><th>Directories</th><td>$WIKI_STATUS_SOURCE_DIRS</td></tr>
    <tr><th>Vault</th><td><code>$WIKI_VAULT_DIR</code></td></tr>
  </table>
</body>
</html>
HTML
}

reset_quartz_content() {
  rm -rf "$WIKI_QUARTZ_DIR/content"
  mkdir -p "$WIKI_QUARTZ_DIR/content"
}

sync_private_content() {
  reset_quartz_content
  rsync -a --delete \
    --exclude '.git/' \
    --exclude '.obsidian/workspace*' \
    --exclude '.obsidian/cache/' \
    --exclude '.stversions/' \
    --exclude '.trash/' \
    "$WIKI_VAULT_DIR/" "$WIKI_QUARTZ_DIR/content/"
}

sync_public_content() {
  local file_path
  local relative_path

  reset_quartz_content
  write_public_index_markdown "$WIKI_QUARTZ_DIR/content"

  while IFS= read -r -d '' file_path; do
    if is_public_markdown "$file_path"; then
      relative_path="${file_path#"$WIKI_VAULT_DIR"/}"
      mkdir -p "$WIKI_QUARTZ_DIR/content/$(dirname "$relative_path")"
      cp -p "$file_path" "$WIKI_QUARTZ_DIR/content/$relative_path"
    fi
  done < <(find "$WIKI_VAULT_DIR" -type f -name '*.md' -print0)

  if [ -d "$WIKI_VAULT_DIR/_public_assets" ]; then
    rsync -a --delete "$WIKI_VAULT_DIR/_public_assets/" "$WIKI_QUARTZ_DIR/content/_public_assets/"
  fi
}

build_quartz_site() {
  local build_tmp_dir="$1"
  local label="$2"

  rm -rf "$build_tmp_dir"
  mkdir -p "$build_tmp_dir"

  cd "$WIKI_QUARTZ_DIR"
  npx quartz build --output "$build_tmp_dir"

  if [ ! -f "$build_tmp_dir/index.html" ]; then
    echo "Quartz $label build did not produce index.html" >&2
    return 1
  fi

  write_build_status "$build_tmp_dir"
}

promote_site() {
  local build_tmp_dir="$1"
  local public_dir="$2"
  local label="$3"
  local previous_dir="${public_dir}.previous"
  local build_device
  local public_device
  local promotion_status

  previous_dir="$(canonicalize_directory "$label previous public directory" "$previous_dir")"
  build_device="$(device_id "$build_tmp_dir")"
  public_device="$(device_id "$(dirname "$public_dir")")"
  if [ "$build_device" != "$public_device" ]; then
    echo "$label build temporary directory and public directory must be on the same filesystem for safe promotion." >&2
    return 1
  fi

  rm -rf "$previous_dir"

  if [ -d "$public_dir" ]; then
    mv "$public_dir" "$previous_dir"
  fi

  if mv "$build_tmp_dir" "$public_dir"; then
    echo "Published $label Quartz site to $public_dir"
  else
    promotion_status=$?
    echo "Failed to promote $label Quartz build to $public_dir." >&2

    if [ -d "$previous_dir" ]; then
      if mv "$previous_dir" "$public_dir"; then
        echo "Restored previous $label site after promotion failure." >&2
      else
        echo "Failed to restore previous $label site from $previous_dir." >&2
      fi
    fi

    return "$promotion_status"
  fi
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
WIKI_PRIVATE_DIR="$(canonicalize_directory 'Private directory' "$WIKI_PRIVATE_DIR")"
WIKI_PRIVATE_BUILD_TMP_DIR="$(canonicalize_directory 'Private build temporary directory' "$WIKI_PRIVATE_BUILD_TMP_DIR")"
WIKI_BUILD_STATE_DIR="$(canonicalize_directory 'Build state directory' "$WIKI_BUILD_STATE_DIR")"
public_previous_dir="$(canonicalize_directory 'Previous public directory' "${WIKI_PUBLIC_DIR}.previous")"
private_previous_dir="$(canonicalize_directory 'Previous private directory' "${WIKI_PRIVATE_DIR}.previous")"

path_names=(
  'vault directory'
  'Quartz directory'
  'public directory'
  'build temporary directory'
  'private directory'
  'private build temporary directory'
  'build state directory'
  'previous public directory'
  'previous private directory'
)
path_values=(
  "$WIKI_VAULT_DIR"
  "$WIKI_QUARTZ_DIR"
  "$WIKI_PUBLIC_DIR"
  "$WIKI_BUILD_TMP_DIR"
  "$WIKI_PRIVATE_DIR"
  "$WIKI_PRIVATE_BUILD_TMP_DIR"
  "$WIKI_BUILD_STATE_DIR"
  "$public_previous_dir"
  "$private_previous_dir"
)

for ((i = 0; i < ${#path_values[@]}; i++)); do
  for ((j = i + 1; j < ${#path_values[@]}; j++)); do
    if paths_overlap "${path_values[i]}" "${path_values[j]}"; then
      echo "Unsafe overlapping build directories: ${path_names[i]} (${path_values[i]}) and ${path_names[j]} (${path_values[j]})" >&2
      exit 1
    fi
  done
done

mkdir -p "$WIKI_BUILD_STATE_DIR"
hash_cmd="$(hash_command)"
fingerprint_file="$WIKI_BUILD_STATE_DIR/markdown.fingerprint"
fingerprint_manifest="$(mktemp "$WIKI_BUILD_STATE_DIR/markdown-manifest.XXXXXX")"
cleanup_fingerprint_manifest() {
  rm -f "$fingerprint_manifest"
}
trap cleanup_fingerprint_manifest EXIT

current_fingerprint="$(markdown_fingerprint "$hash_cmd" "$fingerprint_manifest")"

if [ -f "$fingerprint_file" ] &&
  [ -f "$WIKI_PUBLIC_DIR/index.html" ] &&
  [ -f "$WIKI_PRIVATE_DIR/index.html" ] &&
  [ "$(cat "$fingerprint_file")" = "$current_fingerprint" ]; then
  echo "No Markdown changes detected; skipping Quartz build."
  exit 0
fi

build_status_values

cd "$WIKI_QUARTZ_DIR"
npm install

sync_private_content
write_build_status_markdown "$WIKI_QUARTZ_DIR/content"
build_quartz_site "$WIKI_PRIVATE_BUILD_TMP_DIR" private

sync_public_content
write_build_status_markdown "$WIKI_QUARTZ_DIR/content"
build_quartz_site "$WIKI_BUILD_TMP_DIR" public

promote_site "$WIKI_PRIVATE_BUILD_TMP_DIR" "$WIKI_PRIVATE_DIR" private
promote_site "$WIKI_BUILD_TMP_DIR" "$WIKI_PUBLIC_DIR" public

printf '%s\n' "$current_fingerprint" > "$fingerprint_file"

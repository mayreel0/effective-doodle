#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  install-wiki-tools.sh [--bin-dir PATH]

Installs:
  wiki-init-project

Defaults:
  BIN_DIR: $HOME/.local/bin
USAGE
}

bin_dir="${HOME:-}/.local/bin"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir)
      [ "$#" -ge 2 ] || {
        usage >&2
        exit 2
      }
      bin_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

case "$bin_dir" in
  /*) ;;
  *)
    echo "BIN_DIR must be an absolute path: $bin_dir" >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_script="$script_dir/wiki-init-project.sh"
target="$bin_dir/wiki-init-project"

mkdir -p "$bin_dir"
ln -sfn "$source_script" "$target"

cat <<SUMMARY
Installed wiki tools.

Command:
  $target

Use from any project repository:
  wiki-init-project --agents-only "Project Name"
SUMMARY

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

# shellcheck source=scripts/lib/wiki-env.sh
source "$repo_dir/scripts/lib/wiki-env.sh"
load_wiki_env "${1:-/etc/wiki/wiki.env}"

if [ ! -d "$WIKI_VAULT_DIR/.git" ]; then
  echo "Vault is not a Git repository: $WIKI_VAULT_DIR" >&2
  exit 1
fi

cd "$WIKI_VAULT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add .
  if git diff --cached --quiet; then
    echo "No staged vault changes to commit."
    exit 0
  fi

  git commit -m "[Snapshot] $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  if git remote get-url "$WIKI_GIT_REMOTE" >/dev/null 2>&1; then
    git push "$WIKI_GIT_REMOTE" "$WIKI_GIT_BRANCH"
  else
    echo "Remote '$WIKI_GIT_REMOTE' is not configured; skipping push."
  fi
else
  echo "No vault changes."
fi

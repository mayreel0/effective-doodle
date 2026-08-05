#!/usr/bin/env bash

load_wiki_env() {
  local env_file="${1:-/etc/wiki/wiki.env}"

  if [ ! -f "$env_file" ]; then
    echo "Missing wiki environment file: $env_file" >&2
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a

  : "${WIKI_VAULT_DIR:?WIKI_VAULT_DIR is required}"
  : "${WIKI_QUARTZ_DIR:?WIKI_QUARTZ_DIR is required}"
  : "${WIKI_PUBLIC_DIR:?WIKI_PUBLIC_DIR is required}"
  : "${WIKI_BUILD_TMP_DIR:?WIKI_BUILD_TMP_DIR is required}"
  : "${WIKI_GIT_REMOTE:=origin}"
  : "${WIKI_GIT_BRANCH:=main}"

  export WIKI_VAULT_DIR
  export WIKI_QUARTZ_DIR
  export WIKI_PUBLIC_DIR
  export WIKI_BUILD_TMP_DIR
  export WIKI_GIT_REMOTE
  export WIKI_GIT_BRANCH
}

#!/usr/bin/env bash
set -euo pipefail

bash -n scripts/lib/wiki-env.sh

tmp_env="$(mktemp)"
cat > "$tmp_env" <<'ENV'
WIKI_VAULT_DIR=/tmp/wiki-test/vault
WIKI_QUARTZ_DIR=/tmp/wiki-test/quartz
WIKI_PUBLIC_DIR=/tmp/wiki-test/public
WIKI_BUILD_TMP_DIR=/tmp/wiki-test/public.next
WIKI_GIT_REMOTE=origin
WIKI_GIT_BRANCH=main
ENV

source scripts/lib/wiki-env.sh
load_wiki_env "$tmp_env"

test "$WIKI_VAULT_DIR" = "/tmp/wiki-test/vault"
test "$WIKI_QUARTZ_DIR" = "/tmp/wiki-test/quartz"
test "$WIKI_PUBLIC_DIR" = "/tmp/wiki-test/public"
test "$WIKI_BUILD_TMP_DIR" = "/tmp/wiki-test/public.next"
test "$WIKI_GIT_REMOTE" = "origin"
test "$WIKI_GIT_BRANCH" = "main"

rm -f "$tmp_env"

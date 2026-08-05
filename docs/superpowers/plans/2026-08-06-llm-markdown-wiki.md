# LLM Markdown Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local repository scaffolding, scripts, service templates, and runbooks needed to operate a personal Obsidian + Syncthing + Git + Quartz + LLM Markdown wiki on a Linux home server.

**Architecture:** Obsidian remains the human-owned Markdown source. Syncthing mirrors the vault to `/srv/wiki/vault`, server-side Git records durable history, Quartz builds static HTML into `/srv/wiki/public`, and LLM agents interact with the Markdown filesystem under a conservative write policy.

**Tech Stack:** Markdown, Bash, Git, Syncthing, Quartz, Node.js/npm, systemd, Nginx or Caddy, optional Open WebUI/Ollama RAG later.

## Global Constraints

- Personal knowledge base only; do not add multi-user wiki permissions in the first version.
- Markdown files are the source of truth.
- Obsidian Vault structure must remain compatible with normal Obsidian authoring.
- Syncthing is the primary near-real-time sync mechanism.
- Git is the audit, rollback, and backup mechanism.
- Quartz is the first-version web wiki renderer.
- The web server must serve static output only, not the writable vault.
- LLM free writes are allowed only under `_llm/drafts/`, `_llm/logs/`, and `_llm/indexes/`.
- Risky LLM edits must be written under `_llm/proposed-edits/` first.
- Full vector database RAG is out of scope for the first version.
- Public internet exposure is out of scope until local-only operation is verified.

---

## File Structure

Create this repository as an operations scaffold:

```text
.
  README.md
  config/
    wiki.env.example
    caddy/
      Caddyfile.example
    nginx/
      wiki.conf.example
    syncthing/
      stignore.example
    systemd/
      wiki-build.service
      wiki-build.timer
      wiki-conflict-check.service
      wiki-conflict-check.timer
      wiki-snapshot.service
      wiki-snapshot.timer
  docs/
    operations/
      llm-agent-policy.md
      server-bootstrap.md
      verification-checklist.md
  scripts/
    lib/
      wiki-env.sh
    wiki-build.sh
    wiki-conflicts.sh
    wiki-snapshot.sh
  tests/
    test_config_files.sh
    test_script_syntax.sh
    test_vault_policy.sh
  vault/
    00-Inbox/
    10-Projects/
    20-Areas/
    30-Resources/
    40-Archive/
    _llm/
      drafts/
      indexes/
      logs/
      proposed-edits/
    index.md
```

Responsibilities:

- `config/wiki.env.example`: all path and runtime defaults for scripts and systemd.
- `config/syncthing/stignore.example`: ignore rules copied to the vault root as `.stignore`.
- `config/systemd/*`: scheduled build, snapshot, and conflict detection units.
- `scripts/lib/wiki-env.sh`: shared environment loader and validation helpers.
- `scripts/wiki-build.sh`: safe Quartz build and atomic static output swap.
- `scripts/wiki-conflicts.sh`: reports Syncthing conflict files.
- `scripts/wiki-snapshot.sh`: commits clean vault changes to Git.
- `docs/operations/*`: human runbooks and LLM write policy.
- `tests/*`: shell-based checks that do not require a live home server.
- `vault/*`: starter vault skeleton and LLM-controlled folders.

---

### Task 1: Starter Vault Layout And Ignore Rules

**Files:**
- Create: `README.md`
- Create: `vault/index.md`
- Create: `vault/00-Inbox/.gitkeep`
- Create: `vault/10-Projects/.gitkeep`
- Create: `vault/20-Areas/.gitkeep`
- Create: `vault/30-Resources/.gitkeep`
- Create: `vault/40-Archive/.gitkeep`
- Create: `vault/_llm/drafts/.gitkeep`
- Create: `vault/_llm/indexes/.gitkeep`
- Create: `vault/_llm/logs/.gitkeep`
- Create: `vault/_llm/proposed-edits/.gitkeep`
- Create: `config/syncthing/stignore.example`
- Create: `.gitignore`
- Test: `tests/test_vault_policy.sh`

**Interfaces:**
- Consumes: approved design document at `docs/superpowers/specs/2026-08-06-llm-markdown-wiki-design.md`.
- Produces: vault directory contract used by all later scripts: `vault/`, `vault/_llm/drafts/`, `vault/_llm/logs/`, `vault/_llm/indexes/`, `vault/_llm/proposed-edits/`.

- [ ] **Step 1: Write the failing vault policy test**

Create `tests/test_vault_policy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

required_paths=(
  "vault/index.md"
  "vault/00-Inbox"
  "vault/10-Projects"
  "vault/20-Areas"
  "vault/30-Resources"
  "vault/40-Archive"
  "vault/_llm/drafts"
  "vault/_llm/indexes"
  "vault/_llm/logs"
  "vault/_llm/proposed-edits"
  "config/syncthing/stignore.example"
  ".gitignore"
)

for path in "${required_paths[@]}"; do
  test -e "$path" || {
    echo "Missing required path: $path" >&2
    exit 1
  }
done

grep -qxF ".obsidian/workspace*" config/syncthing/stignore.example
grep -qxF ".stversions/" config/syncthing/stignore.example
grep -qxF "*.sync-conflict-*.md" config/syncthing/stignore.example && {
  echo "Conflict files must not be ignored; they must be reported." >&2
  exit 1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash tests/test_vault_policy.sh
```

Expected: FAIL with at least one `Missing required path` message.

- [ ] **Step 3: Create vault directories and starter index**

Create the listed `vault/` directories and `.gitkeep` files. Create `vault/index.md`:

```markdown
---
title: Home
tags:
  - wiki/home
---

# Home

Welcome to the personal Markdown wiki.

## Entry Points

- [[00-Inbox]]
- [[10-Projects]]
- [[20-Areas]]
- [[30-Resources]]
- [[40-Archive]]
- [[_llm/indexes]]
```

- [ ] **Step 4: Create ignore files**

Create `.gitignore`:

```gitignore
.DS_Store
node_modules/
public/
.quartz-cache/
.env
*.log
```

Create `config/syncthing/stignore.example`:

```gitignore
.obsidian/workspace*
.obsidian/cache
.trash/
.stversions/
node_modules/
public/
.quartz-cache/
.DS_Store
```

- [ ] **Step 5: Create repository README**

Create `README.md`:

```markdown
# LLM Markdown Wiki

Operations scaffold for a personal Obsidian, Syncthing, Git, Quartz, and LLM-agent Markdown wiki.

The Markdown vault is the source of truth. The Linux server syncs the vault, snapshots it with Git, renders it with Quartz, and allows LLM agents to work inside controlled Markdown folders.
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
bash tests/test_vault_policy.sh
```

Expected: PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add README.md .gitignore config/syncthing/stignore.example tests/test_vault_policy.sh vault
git commit -m "feat: add starter vault layout"
```

---

### Task 2: Shared Environment Loader

**Files:**
- Create: `config/wiki.env.example`
- Create: `scripts/lib/wiki-env.sh`
- Create: `tests/test_script_syntax.sh`

**Interfaces:**
- Consumes: no earlier runtime scripts.
- Produces: `load_wiki_env ENV_FILE` Bash function and exported variables `WIKI_VAULT_DIR`, `WIKI_QUARTZ_DIR`, `WIKI_PUBLIC_DIR`, `WIKI_BUILD_TMP_DIR`, `WIKI_GIT_REMOTE`, `WIKI_GIT_BRANCH`.

- [ ] **Step 1: Write the failing syntax and environment test**

Create `tests/test_script_syntax.sh`:

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: FAIL because `scripts/lib/wiki-env.sh` does not exist.

- [ ] **Step 3: Create environment example**

Create `config/wiki.env.example`:

```bash
WIKI_VAULT_DIR=/srv/wiki/vault
WIKI_QUARTZ_DIR=/srv/wiki/quartz
WIKI_PUBLIC_DIR=/srv/wiki/public
WIKI_BUILD_TMP_DIR=/srv/wiki/public.next
WIKI_GIT_REMOTE=origin
WIKI_GIT_BRANCH=main
```

- [ ] **Step 4: Create shared environment loader**

Create `scripts/lib/wiki-env.sh`:

```bash
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
```

- [ ] **Step 5: Make scripts executable**

Run:

```bash
chmod +x tests/test_script_syntax.sh
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add config/wiki.env.example scripts/lib/wiki-env.sh tests/test_script_syntax.sh
git commit -m "feat: add wiki environment loader"
```

---

### Task 3: Git Snapshot Script

**Files:**
- Create: `scripts/wiki-snapshot.sh`
- Modify: `tests/test_script_syntax.sh`

**Interfaces:**
- Consumes: `load_wiki_env ENV_FILE` from `scripts/lib/wiki-env.sh`.
- Produces: executable `scripts/wiki-snapshot.sh ENV_FILE` that commits changes inside `$WIKI_VAULT_DIR` when the vault is a Git repository.

- [ ] **Step 1: Extend syntax test**

Add this line to `tests/test_script_syntax.sh` after the existing `bash -n scripts/lib/wiki-env.sh` line:

```bash
bash -n scripts/wiki-snapshot.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: FAIL because `scripts/wiki-snapshot.sh` does not exist.

- [ ] **Step 3: Create snapshot script**

Create `scripts/wiki-snapshot.sh`:

```bash
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
```

- [ ] **Step 4: Make script executable**

Run:

```bash
chmod +x scripts/wiki-snapshot.sh
```

- [ ] **Step 5: Run syntax test**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: PASS with no output.

- [ ] **Step 6: Manually smoke test against a temporary Git vault**

Run:

```bash
tmp_root="$(mktemp -d)"
mkdir -p "$tmp_root/vault" "$tmp_root/quartz" "$tmp_root/public" "$tmp_root/public.next"
git -C "$tmp_root/vault" init
git -C "$tmp_root/vault" config user.email "wiki@example.local"
git -C "$tmp_root/vault" config user.name "Wiki Snapshot"
printf '# Test\n' > "$tmp_root/vault/test.md"
cat > "$tmp_root/wiki.env" <<ENV
WIKI_VAULT_DIR=$tmp_root/vault
WIKI_QUARTZ_DIR=$tmp_root/quartz
WIKI_PUBLIC_DIR=$tmp_root/public
WIKI_BUILD_TMP_DIR=$tmp_root/public.next
WIKI_GIT_REMOTE=origin
WIKI_GIT_BRANCH=main
ENV
scripts/wiki-snapshot.sh "$tmp_root/wiki.env"
git -C "$tmp_root/vault" log --oneline -1
rm -rf "$tmp_root"
```

Expected: output contains a commit with message starting `[Snapshot]`.

- [ ] **Step 7: Commit**

```bash
git add scripts/wiki-snapshot.sh tests/test_script_syntax.sh
git commit -m "feat: add vault snapshot script"
```

---

### Task 4: Syncthing Conflict Check Script

**Files:**
- Create: `scripts/wiki-conflicts.sh`
- Modify: `tests/test_script_syntax.sh`

**Interfaces:**
- Consumes: `load_wiki_env ENV_FILE`.
- Produces: executable `scripts/wiki-conflicts.sh ENV_FILE` that exits non-zero and lists files matching `*.sync-conflict-*.md`.

- [ ] **Step 1: Extend syntax test**

Add this line to `tests/test_script_syntax.sh`:

```bash
bash -n scripts/wiki-conflicts.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: FAIL because `scripts/wiki-conflicts.sh` does not exist.

- [ ] **Step 3: Create conflict check script**

Create `scripts/wiki-conflicts.sh`:

```bash
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

mapfile -t conflicts < <(find "$WIKI_VAULT_DIR" -type f -name '*.sync-conflict-*.md' | sort)

if [ "${#conflicts[@]}" -eq 0 ]; then
  echo "No Syncthing Markdown conflicts found."
  exit 0
fi

echo "Syncthing Markdown conflicts found:"
printf '%s\n' "${conflicts[@]}"
exit 2
```

- [ ] **Step 4: Make script executable**

Run:

```bash
chmod +x scripts/wiki-conflicts.sh
```

- [ ] **Step 5: Run syntax test**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: PASS with no output.

- [ ] **Step 6: Smoke test conflict detection**

Run:

```bash
tmp_root="$(mktemp -d)"
mkdir -p "$tmp_root/vault" "$tmp_root/quartz" "$tmp_root/public" "$tmp_root/public.next"
touch "$tmp_root/vault/note.sync-conflict-20260806-120000-server.md"
cat > "$tmp_root/wiki.env" <<ENV
WIKI_VAULT_DIR=$tmp_root/vault
WIKI_QUARTZ_DIR=$tmp_root/quartz
WIKI_PUBLIC_DIR=$tmp_root/public
WIKI_BUILD_TMP_DIR=$tmp_root/public.next
WIKI_GIT_REMOTE=origin
WIKI_GIT_BRANCH=main
ENV
set +e
scripts/wiki-conflicts.sh "$tmp_root/wiki.env"
status=$?
set -e
rm -rf "$tmp_root"
test "$status" -eq 2
```

Expected: command prints the conflict file and exits with status `2`.

- [ ] **Step 7: Commit**

```bash
git add scripts/wiki-conflicts.sh tests/test_script_syntax.sh
git commit -m "feat: add Syncthing conflict check"
```

---

### Task 5: Safe Quartz Build Script

**Files:**
- Create: `scripts/wiki-build.sh`
- Modify: `tests/test_script_syntax.sh`

**Interfaces:**
- Consumes: `load_wiki_env ENV_FILE`.
- Produces: executable `scripts/wiki-build.sh ENV_FILE` that copies vault content into Quartz `content/`, builds static HTML, and only swaps public output after a successful build.

- [ ] **Step 1: Extend syntax test**

Add this line to `tests/test_script_syntax.sh`:

```bash
bash -n scripts/wiki-build.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: FAIL because `scripts/wiki-build.sh` does not exist.

- [ ] **Step 3: Create build script**

Create `scripts/wiki-build.sh`:

```bash
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
```

- [ ] **Step 4: Make script executable**

Run:

```bash
chmod +x scripts/wiki-build.sh
```

- [ ] **Step 5: Run syntax test**

Run:

```bash
bash tests/test_script_syntax.sh
```

Expected: PASS with no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/wiki-build.sh tests/test_script_syntax.sh
git commit -m "feat: add safe Quartz build script"
```

---

### Task 6: systemd Service And Timer Templates

**Files:**
- Create: `config/systemd/wiki-build.service`
- Create: `config/systemd/wiki-build.timer`
- Create: `config/systemd/wiki-conflict-check.service`
- Create: `config/systemd/wiki-conflict-check.timer`
- Create: `config/systemd/wiki-snapshot.service`
- Create: `config/systemd/wiki-snapshot.timer`
- Create: `tests/test_config_files.sh`

**Interfaces:**
- Consumes: executable scripts from Tasks 3, 4, and 5 installed under `/srv/wiki/ops/scripts/`.
- Produces: systemd units that can be copied to `/etc/systemd/system/`.

- [ ] **Step 1: Write failing config test**

Create `tests/test_config_files.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

files=(
  "config/systemd/wiki-build.service"
  "config/systemd/wiki-build.timer"
  "config/systemd/wiki-conflict-check.service"
  "config/systemd/wiki-conflict-check.timer"
  "config/systemd/wiki-snapshot.service"
  "config/systemd/wiki-snapshot.timer"
  "config/caddy/Caddyfile.example"
  "config/nginx/wiki.conf.example"
)

for file in "${files[@]}"; do
  test -f "$file" || {
    echo "Missing config file: $file" >&2
    exit 1
  }
done

grep -q "ExecStart=/srv/wiki/ops/scripts/wiki-build.sh /etc/wiki/wiki.env" config/systemd/wiki-build.service
grep -q "ExecStart=/srv/wiki/ops/scripts/wiki-snapshot.sh /etc/wiki/wiki.env" config/systemd/wiki-snapshot.service
grep -q "ExecStart=/srv/wiki/ops/scripts/wiki-conflicts.sh /etc/wiki/wiki.env" config/systemd/wiki-conflict-check.service
grep -q "OnCalendar=*:0/10" config/systemd/wiki-build.timer
grep -q "OnCalendar=*:0/15" config/systemd/wiki-snapshot.timer
grep -q "OnCalendar=hourly" config/systemd/wiki-conflict-check.timer
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash tests/test_config_files.sh
```

Expected: FAIL because systemd and web server config files do not exist.

- [ ] **Step 3: Create build service and timer**

Create `config/systemd/wiki-build.service`:

```ini
[Unit]
Description=Build Quartz Markdown wiki
After=network-online.target

[Service]
Type=oneshot
User=wiki
Group=wiki
ExecStart=/srv/wiki/ops/scripts/wiki-build.sh /etc/wiki/wiki.env
```

Create `config/systemd/wiki-build.timer`:

```ini
[Unit]
Description=Build Quartz Markdown wiki every 10 minutes

[Timer]
OnBootSec=2min
OnCalendar=*:0/10
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Create snapshot service and timer**

Create `config/systemd/wiki-snapshot.service`:

```ini
[Unit]
Description=Commit and push Markdown wiki vault snapshot
After=network-online.target

[Service]
Type=oneshot
User=wiki
Group=wiki
ExecStart=/srv/wiki/ops/scripts/wiki-snapshot.sh /etc/wiki/wiki.env
```

Create `config/systemd/wiki-snapshot.timer`:

```ini
[Unit]
Description=Snapshot Markdown wiki vault every 15 minutes

[Timer]
OnBootSec=3min
OnCalendar=*:0/15
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Create conflict check service and timer**

Create `config/systemd/wiki-conflict-check.service`:

```ini
[Unit]
Description=Check Syncthing Markdown wiki conflicts

[Service]
Type=oneshot
User=wiki
Group=wiki
ExecStart=/srv/wiki/ops/scripts/wiki-conflicts.sh /etc/wiki/wiki.env
```

Create `config/systemd/wiki-conflict-check.timer`:

```ini
[Unit]
Description=Check Syncthing Markdown wiki conflicts hourly

[Timer]
OnBootSec=5min
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 6: Create local web server examples**

Create `config/caddy/Caddyfile.example`:

```caddyfile
wiki.local {
  root * /srv/wiki/public
  file_server
}
```

Create `config/nginx/wiki.conf.example`:

```nginx
server {
  listen 80;
  server_name wiki.local;

  root /srv/wiki/public;
  index index.html;

  location / {
    try_files $uri $uri/ $uri.html =404;
  }
}
```

- [ ] **Step 7: Run config test**

Run:

```bash
bash tests/test_config_files.sh
```

Expected: PASS with no output.

- [ ] **Step 8: Commit**

```bash
git add config/systemd config/caddy config/nginx tests/test_config_files.sh
git commit -m "feat: add wiki service templates"
```

---

### Task 7: Operations Runbooks And LLM Agent Policy

**Files:**
- Create: `docs/operations/server-bootstrap.md`
- Create: `docs/operations/llm-agent-policy.md`
- Create: `docs/operations/verification-checklist.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all scripts and config paths established by Tasks 1-6.
- Produces: human-readable operating procedure and LLM write policy.

- [ ] **Step 1: Create server bootstrap runbook**

Create `docs/operations/server-bootstrap.md`:

```markdown
# Server Bootstrap

## Paths

- `/srv/wiki/ops`: this operations repository
- `/srv/wiki/vault`: synchronized Obsidian vault
- `/srv/wiki/quartz`: Quartz installation
- `/srv/wiki/public`: static site served by Caddy or Nginx
- `/etc/wiki/wiki.env`: local runtime environment file

## Server Setup

1. Create the service user:

   ```bash
   sudo useradd --system --create-home --home-dir /srv/wiki --shell /usr/sbin/nologin wiki
   ```

2. Create directories:

   ```bash
   sudo mkdir -p /srv/wiki/ops /srv/wiki/vault /srv/wiki/quartz /srv/wiki/public /etc/wiki
   sudo chown -R wiki:wiki /srv/wiki
   ```

3. Copy `config/wiki.env.example` to `/etc/wiki/wiki.env` and adjust paths only if needed.

4. Copy `config/syncthing/stignore.example` to `/srv/wiki/vault/.stignore`.

5. Configure Syncthing to sync the main PC Obsidian vault to `/srv/wiki/vault`.

6. Initialize Git inside `/srv/wiki/vault`:

   ```bash
   sudo -u wiki git -C /srv/wiki/vault init
   sudo -u wiki git -C /srv/wiki/vault config user.email wiki@example.local
   sudo -u wiki git -C /srv/wiki/vault config user.name "Wiki Snapshot"
   ```

7. Install Quartz in `/srv/wiki/quartz` using the official Quartz setup flow.

8. Copy systemd units from `config/systemd/` to `/etc/systemd/system/`.

9. Enable timers:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now wiki-build.timer wiki-snapshot.timer wiki-conflict-check.timer
   ```

10. Configure Caddy or Nginx to serve `/srv/wiki/public` on the local network.
```

- [ ] **Step 2: Create LLM policy**

Create `docs/operations/llm-agent-policy.md`:

```markdown
# LLM Agent Policy

## Allowed Reads

The agent may read Markdown files, attachments, and Git history inside `/srv/wiki/vault`.

## Default Write Zones

The agent may create and edit files under:

- `/srv/wiki/vault/_llm/drafts/`
- `/srv/wiki/vault/_llm/logs/`
- `/srv/wiki/vault/_llm/indexes/`

## Proposed Edit Zone

When a requested change may rewrite or substantially alter a human-authored note, the agent must write a proposal under:

- `/srv/wiki/vault/_llm/proposed-edits/`

## Direct Human Note Edits

The agent may directly edit notes outside `_llm/` only when the user explicitly asks for that edit.

## Required After Write

After any write, the agent must run:

```bash
git -C /srv/wiki/vault status --short
```

For intentional changes, the agent must commit with a message beginning with one of:

- `[LLM draft]`
- `[LLM edit]`
- `[LLM index]`
- `[LLM log]`
```

- [ ] **Step 3: Create verification checklist**

Create `docs/operations/verification-checklist.md`:

```markdown
# Verification Checklist

- [ ] A note created on the main PC appears under `/srv/wiki/vault`.
- [ ] `.obsidian/workspace*` files do not sync to the server vault.
- [ ] `scripts/wiki-conflicts.sh /etc/wiki/wiki.env` reports no conflicts.
- [ ] `scripts/wiki-snapshot.sh /etc/wiki/wiki.env` creates a Git commit when a note changes.
- [ ] `scripts/wiki-build.sh /etc/wiki/wiki.env` creates `/srv/wiki/public/index.html`.
- [ ] The local web server opens the Quartz home page.
- [ ] A wikilink renders as a link in the web wiki.
- [ ] Quartz search can find a known note title.
- [ ] The LLM agent can create a note under `_llm/drafts/`.
- [ ] The LLM agent does not modify human-authored notes without explicit instruction.
```

- [ ] **Step 4: Update README with operating map**

Append to `README.md`:

```markdown

## Operating Map

- Start with `docs/operations/server-bootstrap.md`.
- Use `config/wiki.env.example` as the server environment template.
- Use `config/syncthing/stignore.example` as the Syncthing ignore template.
- Use `scripts/wiki-snapshot.sh` for Git durability snapshots.
- Use `scripts/wiki-build.sh` for Quartz publishing.
- Use `scripts/wiki-conflicts.sh` to detect Syncthing conflict files.
- Use `docs/operations/llm-agent-policy.md` before granting an LLM agent write access.
```

- [ ] **Step 5: Run all local tests**

Run:

```bash
bash tests/test_vault_policy.sh
bash tests/test_script_syntax.sh
bash tests/test_config_files.sh
```

Expected: all pass with no output.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/operations
git commit -m "docs: add wiki operations runbooks"
```

---

### Task 8: Final Local Verification

**Files:**
- Modify: none expected.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-7.
- Produces: verified local scaffold ready for server adaptation.

- [ ] **Step 1: Run all tests**

Run:

```bash
bash tests/test_vault_policy.sh
bash tests/test_script_syntax.sh
bash tests/test_config_files.sh
```

Expected: all pass with no output.

- [ ] **Step 2: Check Git status**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 3: Review generated file list**

Run:

```bash
find . -maxdepth 4 -type f | sort
```

Expected: output includes the planned `config/`, `docs/operations/`, `scripts/`, `tests/`, and `vault/` files.

- [ ] **Step 4: Record implementation completion**

No commit is needed if the working tree is clean. If any final documentation correction is made, commit it:

```bash
git add README.md docs config scripts tests vault
git commit -m "docs: finalize wiki scaffold"
```

---

## Self-Review

Spec coverage:

- Vault layout is covered by Task 1.
- Syncthing ignore rules are covered by Task 1.
- Server path conventions are covered by Tasks 2 and 7.
- Quartz build script and safe publish behavior are covered by Task 5.
- Git snapshot script and scheduled service are covered by Tasks 3 and 6.
- LLM agent access policy is covered by Task 7.
- Conflict detection is covered by Task 4.
- Local verification checklist is covered by Tasks 7 and 8.
- RAG is intentionally deferred and documented as out of scope for the first version.

Placeholder scan:

- No placeholder markers or undefined future implementation slots are intentionally left in the plan.

Type and interface consistency:

- All Bash scripts consume `load_wiki_env ENV_FILE`.
- All scripts use the same environment variable names from `config/wiki.env.example`.
- systemd units call scripts using the planned `/srv/wiki/ops/scripts/` installation path.

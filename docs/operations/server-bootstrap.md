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

6. Initialize Git on the configured `main` branch inside `/srv/wiki/vault`, then add the off-server backup remote:

   ```bash
   sudo -u wiki git -C /srv/wiki/vault init --initial-branch=main
   sudo -u wiki git -C /srv/wiki/vault config user.email wiki@example.local
   sudo -u wiki git -C /srv/wiki/vault config user.name "Wiki Snapshot"
   backup_url='ssh://git@example.com/path/to/wiki-vault.git'
   sudo -u wiki git -C /srv/wiki/vault remote add origin "$backup_url"
   sudo -u wiki git -C /srv/wiki/vault branch --show-current
   sudo -u wiki git -C /srv/wiki/vault remote get-url origin
   ```

   The verification commands must print `main` and the configured backup URL. Keep those names aligned with `WIKI_GIT_BRANCH` and `WIKI_GIT_REMOTE` in `/etc/wiki/wiki.env`; the snapshot script refuses to run on a different branch. If no remote is configured, snapshots are committed locally and the push is explicitly skipped, so they are not yet off-server backups.

7. Install Quartz in `/srv/wiki/quartz` using the official Quartz setup flow.

8. Copy systemd units from `config/systemd/` to `/etc/systemd/system/`.

9. Enable timers:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now wiki-build.timer wiki-snapshot.timer wiki-conflict-check.timer
   ```

10. Configure Caddy or Nginx to serve the static `/srv/wiki/public` output locally first, using the local-only examples in `config/caddy/` or `config/nginx/`.

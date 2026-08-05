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

10. Configure Caddy or Nginx to serve the static `/srv/wiki/public` output locally first, using the local-only examples in `config/caddy/` or `config/nginx/`.

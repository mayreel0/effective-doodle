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
grep -Fq "OnCalendar=*:0/10" config/systemd/wiki-build.timer
grep -Fq "OnCalendar=*:0/15" config/systemd/wiki-snapshot.timer
grep -Fq "OnCalendar=hourly" config/systemd/wiki-conflict-check.timer

grep -Fq ":9009" config/caddy/Caddyfile.example
grep -Fq ":9010" config/caddy/Caddyfile.example
grep -Fq "root * /srv/wiki/public" config/caddy/Caddyfile.example
grep -Fq "root * /srv/wiki/private" config/caddy/Caddyfile.example
! grep -Fq "/srv/wiki/vault" config/caddy/Caddyfile.example

grep -Fq "listen 9009;" config/nginx/wiki.conf.example
grep -Fq "listen 9010;" config/nginx/wiki.conf.example
grep -Fq "root /srv/wiki/public;" config/nginx/wiki.conf.example
grep -Fq "root /srv/wiki/private;" config/nginx/wiki.conf.example
grep -Fq "auth_basic_user_file /etc/nginx/.wiki-private.htpasswd;" config/nginx/wiki.conf.example
! grep -Fq "/srv/wiki/vault" config/nginx/wiki.conf.example

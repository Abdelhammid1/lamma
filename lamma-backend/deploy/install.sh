#!/usr/bin/env bash
# One-shot installer for the lamma-backend Flask app.
#
# Prereqs on the target VM (Ubuntu/Debian assumed):
#   - Python 3.10+
#   - nginx already serving lamma.manasety.ai
#   - Root (sudo) access
#   - A fine-grained GitHub PAT with Contents: R/W on zyadwael/birthday-media
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Abdelhammid1/lamma/main/lamma-backend/deploy/install.sh | sudo bash
#   # or clone first, then: sudo bash lamma-backend/deploy/install.sh
#
# Safe to re-run — updates the code + restarts the service.

set -euo pipefail

REPO_URL="https://github.com/Abdelhammid1/lamma.git"
REPO_DIR="/opt/lamma"
BACKEND_DIR="$REPO_DIR/lamma-backend"
STATE_DIR="/var/lib/lamma-backend"
ENV_FILE="/etc/lamma-backend.env"
SERVICE_NAME="lamma-backend"
NGINX_SITE="/etc/nginx/sites-available/lamma.manasety.ai"  # adjust if named differently

if [[ $EUID -ne 0 ]]; then
  echo "This script must run as root (use sudo)." >&2
  exit 1
fi

echo "==> 1/8  Installing OS packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  git python3 python3-venv python3-pip

echo "==> 2/8  Creating 'lamma' service user"
if ! id lamma >/dev/null 2>&1; then
  useradd --system --home-dir "$REPO_DIR" --shell /usr/sbin/nologin lamma
fi

echo "==> 3/8  Cloning / updating source at $REPO_DIR"
if [[ -d "$REPO_DIR/.git" ]]; then
  git -C "$REPO_DIR" fetch --depth=1 origin main
  git -C "$REPO_DIR" reset --hard origin/main
else
  rm -rf "$REPO_DIR"
  git clone --depth=1 "$REPO_URL" "$REPO_DIR"
fi
chown -R lamma:lamma "$REPO_DIR"

echo "==> 4/8  Creating Python venv + installing requirements"
sudo -u lamma python3 -m venv "$BACKEND_DIR/.venv"
sudo -u lamma "$BACKEND_DIR/.venv/bin/pip" install --upgrade pip
sudo -u lamma "$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"

echo "==> 5/8  Creating state dirs under $STATE_DIR"
install -d -o lamma -g lamma -m 0755 \
    "$STATE_DIR" \
    "$STATE_DIR/uploads" \
    "$STATE_DIR/media" \
    "$STATE_DIR/data"

echo "==> 6/8  Environment file $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  # GITHUB_TOKEN is now optional — the publish path writes to local disk,
  # not GitHub. We still accept one in case you re-enable the old path.
  read -r -p "  GitHub PAT (optional — press ENTER to skip): " GH_TOKEN
  read -r -p "  Flask SECRET_KEY (leave blank to auto-generate): " SECRET
  if [[ -z "$SECRET" ]]; then
    SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  fi
  cat > "$ENV_FILE" <<ENV
SECRET_KEY=$SECRET
DATABASE_URL=sqlite:///$STATE_DIR/app.db
GITHUB_TOKEN=$GH_TOKEN
MEDIA_OWNER=zyadwael
MEDIA_REPO=birthday-media
MEDIA_BRANCH=main
PUBLIC_DOMAIN=manasety.ai
UPLOAD_STAGING_DIR=$STATE_DIR/uploads
MEDIA_SERVE_DIR=$STATE_DIR/media
DATA_SERVE_DIR=$STATE_DIR/data
RATELIMIT_STORAGE_URI=memory://
SCHEDULER_ENABLED=1
ENV
  chown root:lamma "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "  wrote $ENV_FILE"
else
  # Ensure the two new vars exist in an older env file; append if missing.
  grep -q "^MEDIA_SERVE_DIR=" "$ENV_FILE" || echo "MEDIA_SERVE_DIR=$STATE_DIR/media" >> "$ENV_FILE"
  grep -q "^DATA_SERVE_DIR="  "$ENV_FILE" || echo "DATA_SERVE_DIR=$STATE_DIR/data"   >> "$ENV_FILE"
  echo "  $ENV_FILE already exists — appended MEDIA_SERVE_DIR / DATA_SERVE_DIR if missing"
fi

echo "==> 7/8  Installing systemd unit"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=LAMMA backend (Flask + gunicorn)
After=network.target

[Service]
Type=simple
User=lamma
Group=lamma
WorkingDirectory=$BACKEND_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BACKEND_DIR/.venv/bin/gunicorn \\
    --bind 127.0.0.1:8010 \\
    --workers 2 \\
    --timeout 300 \\
    --access-logfile - \\
    --error-logfile - \\
    wsgi:app
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$STATE_DIR
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"
sleep 1
systemctl --no-pager --lines=10 status "${SERVICE_NAME}.service" || true

echo "==> 8/8  Sanity check — Flask should be answering on 127.0.0.1:8010"
if curl -fsS -X POST http://127.0.0.1:8010/api/check-slug \
     -H 'content-type: application/json' \
     -d '{"slug":"ping"}' >/dev/null; then
  echo "  Flask OK ✓"
else
  echo "  Flask is NOT answering. Check: journalctl -u ${SERVICE_NAME} -f" >&2
  exit 1
fi

cat <<'NGINX_HINT'

===============================================================================
Last step (manual — I don't touch your nginx config automatically):

Add these blocks INSIDE the `server { ... }` for lamma.manasety.ai
(usually /etc/nginx/sites-available/lamma.manasety.ai), BEFORE the
static `location /` catch-all:

    client_max_body_size 110m;

    location /api/ {
        proxy_pass         http://127.0.0.1:8010;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_request_buffering off;
    }

    location /admin  { proxy_pass http://127.0.0.1:8010; proxy_set_header Host $host; }
    location /admin/ { proxy_pass http://127.0.0.1:8010; proxy_set_header Host $host; }

    # Published invitation payloads (JSON) + their media files, written
    # by activate_event to MEDIA_SERVE_DIR / DATA_SERVE_DIR. Serving them
    # directly from nginx bypasses Flask for every guest page load.
    # The `alias` paths must match the dirs the install script created
    # (/var/lib/lamma-backend/{data,media} by default).
    location /data/ {
        alias /var/lib/lamma-backend/data/;
        add_header Cache-Control "public, max-age=300";
        add_header X-Content-Type-Options "nosniff";
        default_type application/octet-stream;
        types { application/json json; }
        try_files $uri =404;
    }
    # Media is customer-uploaded on the same origin as /admin, so the
    # defense against an attacker uploading a .html / .svg / .xml and
    # getting it rendered is layered: an extension allowlist in the
    # location regex, an explicit per-type map, nosniff, and a sandbox
    # CSP that defangs any script that did sneak in.
    location ~* ^/media/[a-z0-9][a-z0-9-]*/[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp|mp4|mov|webm|mp3|m4a|aac|ogg|wav)$ {
        alias /var/lib/lamma-backend/media/;
        add_header Cache-Control "public, max-age=604800, immutable";
        add_header X-Content-Type-Options "nosniff";
        add_header Content-Security-Policy "sandbox; default-src 'none'";
        default_type application/octet-stream;
        types {
            image/jpeg      jpg jpeg;
            image/png       png;
            image/gif       gif;
            image/webp      webp;
            video/mp4       mp4;
            video/quicktime mov;
            video/webm      webm;
            audio/mpeg      mp3;
            audio/mp4       m4a;
            audio/aac       aac;
            audio/ogg       ogg;
            audio/wav       wav;
        }
        try_files $uri =404;
    }
    # Any other /media/ shape never reaches disk — 404 before alias
    # resolution so the attacker can't fish for extensions.
    location /media/ { return 404; }

Then:
    sudo nginx -t && sudo systemctl reload nginx

Verify from any machine:
    curl -X POST https://lamma.manasety.ai/api/check-slug \
         -H 'content-type: application/json' \
         -d '{"slug":"test"}'
    # → expect: {"available":true,"slug":"test"}

Create an admin user for the codes panel:
    sudo -u lamma $BACKEND_DIR/.venv/bin/flask --app app \
        create-admin --email you@example.com --password 'ChangeMe!'

Updating later (safe to run any time):
    curl -fsSL https://raw.githubusercontent.com/Abdelhammid1/lamma/main/lamma-backend/deploy/install.sh | sudo bash
===============================================================================
NGINX_HINT

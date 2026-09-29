# لمة · LAMMA Backend

Self-serve event creation backend for `lamma.manasety.ai`.

Turns anyone-with-an-activation-code into a published birthday /
wedding / invitation page. **All GitHub API access is server-side** — the
frontend never sees a token.

## Status

- [x] **Stage 1** — Flask skeleton, slug validation, `POST /api/check-slug`
- [x] **Stage 2** — Event creation + media upload staging + status poll
- [x] **Stage 3** — GitHub proxy + activation flow
- [x] **Stage 4** — Admin dashboard (Flask-Login + Jinja + `create-admin` CLI)
- [x] **Stage 5** — Rate limits + 48-hour cleanup cron
- [ ] Stage 6 — Frontend integration in the `lamma` static repo (separate PR)
- [x] **Stage 7** — README + deploy artifacts

**Tests: 126 passing.**

## Stack

Flask 3 · SQLAlchemy 3 · SQLite · Flask-Login · passlib[bcrypt] ·
Flask-Limiter · APScheduler · Gunicorn · systemd. Same layout as
`marsoud` for operational consistency.

## Local dev

```bash
cd lamma-backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Tests — no config needed (in-memory SQLite, mocked GitHub)
python -m pytest -q

# Create an admin user
flask --app app create-admin --email you@example.com --password s3cret-pass

# Run the dev server on :8010
flask --app app run --port 8010
```

Then:
- `curl -X POST http://127.0.0.1:8010/api/check-slug -H 'content-type: application/json' -d '{"slug":"medo"}'`
- <http://127.0.0.1:8010/admin/login>

## Environment variables (production)

See `deploy/lamma-backend.env.sample`. Key ones:

| Var | What it does |
|---|---|
| `SECRET_KEY` | Flask session signing. Rotate = every admin gets logged out. |
| `DATABASE_URL` | `sqlite:////var/lib/lamma-backend/app.db` in prod. |
| `GITHUB_TOKEN` | Fine-grained PAT with `Contents: Read+Write` on the media repo, nothing else. |
| `MEDIA_OWNER` / `MEDIA_REPO` / `MEDIA_BRANCH` | Where events get committed. |
| `PUBLIC_DOMAIN` | Used to build success URLs (`https://<slug>.<domain>/`). |
| `UPLOAD_STAGING_DIR` | Where files land pre-activation. `/var/lib/lamma-backend/uploads` in prod. |
| `RATELIMIT_STORAGE_URI` | `memory://` for single worker. `redis://localhost:6379` for multi-worker. |
| `SCHEDULER_ENABLED` | `0` to disable the 48h cleanup (useful for migrations). |

## Deploy (DevOps)

Copy files from `deploy/`:
- `lamma-backend.service` → `/etc/systemd/system/`
- `nginx.conf.sample` → merge into your existing vhost for `lamma.manasety.ai`
- `lamma-backend.env.sample` → `/etc/lamma-backend.env` (chmod 600)

```
sudo useradd -r -s /bin/false lamma
sudo install -d -o lamma -g lamma /var/lib/lamma-backend /var/lib/lamma-backend/uploads /opt/lamma-backend
sudo -u lamma git clone <this repo> /opt/lamma-backend
sudo -u lamma python -m venv /opt/lamma-backend/.venv
sudo -u lamma /opt/lamma-backend/.venv/bin/pip install -r /opt/lamma-backend/requirements.txt

sudo systemctl daemon-reload
sudo systemctl enable --now lamma-backend
sudo nginx -t && sudo systemctl reload nginx

# First admin user
sudo -u lamma /opt/lamma-backend/.venv/bin/flask --app app create-admin \
    --email you@manasety.ai --password 'REDACTED'
```

## Routes

### Public (`/api/*`) — JSON

| Method | Path | Body / notes |
|---|---|---|
| `GET`  | `/api/health` | Liveness. |
| `POST` | `/api/check-slug` | `{ slug }` → `{ available, reason?, message? }`. Rate: 30/min per IP. |
| `POST` | `/api/events` | `{ slug, event_type, contact?, payload_json? }` → `{ event_id, slug, status }`. Rate: 5/hour per IP. |
| `POST` | `/api/events/:id/media` | `multipart/form-data` with field `file`. Max 50 MB. Types: jpeg/png/webp/gif/mp4/webm/mov. Per-event cap 300 MB. |
| `GET`  | `/api/events/:id/status` | Poll. |
| `POST` | `/api/events/:id/activate` | `{ code }`. Commits JSON + media to GitHub, marks published. Rate: 10/hour per IP. |

### Admin (`/admin/*`) — session-gated

| Method | Path |
|---|---|
| `GET/POST` | `/admin/login` |
| `POST` | `/admin/logout` |
| `GET`  | `/admin/` (dashboard: counts + recent) |
| `GET`  | `/admin/events` (list + filter + search) |
| `POST` | `/admin/events/:id/generate-code` |
| `POST` | `/admin/events/:id/delete` |

Every admin write appends to `audit_log`.

## Security notes

- The GitHub PAT lives ONLY in `/etc/lamma-backend.env` (chmod 600, systemd
  loads it). Frontend never sees it.
- Admin password stored via bcrypt (passlib), never plaintext.
- Reserved slug list in `slugs.py` — company subdomains (marsoud, lex,
  etc.) can never be claimed by customers.
- 48h cleanup (in `scheduler.py`) auto-expires unactivated events so
  slugs can't be squatted.
- Rate limits on all mutating endpoints (Flask-Limiter, memory storage
  by default — switch to Redis when going multi-worker).
- Activation codes are single-use and (recommended) event-bound.

## Backup

SQLite lives at `/var/lib/lamma-backend/app.db`. Nightly rsync to an
off-box location is enough — it's a single file that's safe to copy
while the app runs (SQLite WAL is atomic per checkpoint).

## Project layout

```
lamma-backend/
├── app.py                    Flask factory
├── config.py                 env-driven Config + TestConfig
├── wsgi.py                   gunicorn entrypoint
├── models.py                 Event · ActivationCode · Admin · MediaBlob · AuditLog
├── slugs.py                  format + reserved list + availability
├── github.py                 Contents API wrapper (get/put/delete/list_dir)
├── codes.py                  activation code generate + validate
├── auth.py                   Flask-Login + bcrypt
├── cli.py                    `flask create-admin`
├── uploads.py                staging on local disk
├── rate_limit.py             Flask-Limiter setup
├── scheduler.py              APScheduler 48h cleanup job
├── blueprints/
│   ├── public.py             /api/*
│   └── admin.py              /admin/*
├── templates/admin/          login, dashboard, events, code_generated (Jinja)
├── static/admin/             admin.css
├── tests/                    126 tests (unit + integration, mocked GitHub)
└── deploy/
    ├── lamma-backend.service       systemd unit sample
    ├── nginx.conf.sample           nginx location blocks
    └── lamma-backend.env.sample    env-file with all required vars
```

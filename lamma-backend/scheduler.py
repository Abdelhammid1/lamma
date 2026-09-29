"""Background jobs.

Runs inside the same Python process as Flask (APScheduler's BackgroundScheduler).
Fine for a single-node deployment; move to a separate cron/systemd timer
if the service grows.

Current job: `cleanup_expired_events` — every 15 minutes, any event in
status `draft` or `awaiting_code` older than 48 hours is:
  - marked `status = expired` (row kept for audit)
  - its staging files on disk are removed
  - its slug becomes available again
"""

import logging
import os
import shutil
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask


CLEANUP_AFTER_HOURS = 48
JOB_INTERVAL_MINUTES = 15
log = logging.getLogger(__name__)


def cleanup_expired_events(app: Flask) -> int:
    """Run the sweep once. Returns the number of events expired."""
    from models import Event, MediaBlob, db

    cutoff = datetime.utcnow() - timedelta(hours=CLEANUP_AFTER_HOURS)
    staging_root = app.config["UPLOAD_STAGING_DIR"]

    with app.app_context():
        stale = (
            db.session.query(Event)
            .filter(Event.status.in_(("draft", "awaiting_code")))
            .filter(Event.created_at < cutoff)
            .all()
        )
        expired_count = 0
        for ev in stale:
            # Remove staging directory for this event
            dpath = os.path.join(staging_root, ev.id)
            if os.path.isdir(dpath):
                shutil.rmtree(dpath, ignore_errors=True)
            # Remove MediaBlob rows (cascade would also, but be explicit)
            db.session.query(MediaBlob).filter_by(event_id=ev.id).delete()
            ev.status = "expired"
            expired_count += 1
        db.session.commit()

    if expired_count:
        log.info("cleanup: expired %d event(s)", expired_count)
    return expired_count


def init_scheduler(app: Flask) -> BackgroundScheduler | None:
    """Start APScheduler with the cleanup job. Returns the scheduler
    (or None if disabled). Safe to call repeatedly under `flask run`
    reloader; only the parent process schedules jobs."""
    if not app.config.get("SCHEDULER_ENABLED", True):
        return None
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        # Reloader parent shouldn't start jobs — child (WERKZEUG_RUN_MAIN=true) does
        pass

    scheduler = BackgroundScheduler(timezone="UTC", daemon=True)
    scheduler.add_job(
        lambda: cleanup_expired_events(app),
        "interval",
        minutes=JOB_INTERVAL_MINUTES,
        id="cleanup_expired_events",
        replace_existing=True,
    )
    scheduler.start()
    log.info("scheduler: started, cleanup every %d min", JOB_INTERVAL_MINUTES)
    return scheduler

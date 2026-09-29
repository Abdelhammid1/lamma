"""Flask CLI commands.

    flask --app app create-admin --email me@x.com --password s3cret
"""

import click
from flask.cli import with_appcontext

from auth import hash_password
from models import Admin, db


@click.command("create-admin")
@click.option("--email", required=True, help="Admin email address.")
@click.option("--password", required=True, help="Password (min 8 chars).")
@with_appcontext
def create_admin(email: str, password: str) -> None:
    """Create a new admin user. Fails if the email is already registered."""
    email = email.strip().lower()
    if len(password) < 8:
        raise click.UsageError("Password must be at least 8 characters.")

    if db.session.query(Admin).filter_by(email=email).first():
        raise click.UsageError(f"An admin with email {email!r} already exists.")

    row = Admin(email=email, password_hash=hash_password(password))
    db.session.add(row)
    db.session.commit()
    click.echo(f"✓ Created admin {email} (id={row.id})")


def register_cli(app) -> None:
    """Attach every CLI command in this module to the app."""
    app.cli.add_command(create_admin)

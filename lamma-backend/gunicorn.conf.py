"""gunicorn settings that must hold however the service is started.

gunicorn reads ./gunicorn.conf.py from its working directory (the systemd
unit's WorkingDirectory), so this applies with no change to the unit.
Flags on the ExecStart line still win over anything set here.
"""

# gunicorn >= 25.1 opens a control socket for the `gunicornc` tool at
# $HOME/.gunicorn/gunicorn.ctl. The service user's home is read-only under
# ProtectSystem=strict, so it logged an error on every start. We don't use
# gunicornc. Older gunicorn ignores this unknown setting.
control_socket_disable = True

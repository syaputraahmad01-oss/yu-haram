#!/usr/bin/env python3
"""Double-fork launcher for the PRODUCTION standalone server (.next/standalone).

Same survival technique as scripts/dev-daemon.py: the driver kills every
process still attached to a Bash tool call's tree when the call ends; a
double-fork re-parents the server to PID 1 (tini) so it stays alive between
tool calls. Used only for production verification runs — the dev server is
normally restored afterwards via scripts/dev-daemon.py.

Usage:  python3 scripts/prod-daemon.py [port]   (default 3000)
Stop:   pkill -f 'standalone/server.js'
Log:    /home/z/my-project/prod-server.log
"""
import os
import sys

PROJECT = "/home/z/my-project"
SERVER = os.path.join(PROJECT, ".next", "standalone", "server.js")
LOG = os.path.join(PROJECT, "prod-server.log")
PORT = sys.argv[1] if len(sys.argv) > 1 else "3000"

pid = os.fork()
if pid == 0:
    os.setsid()
    pid2 = os.fork()
    if pid2 == 0:
        os.chdir(os.path.join(PROJECT, ".next", "standalone"))
        env = dict(os.environ)
        env["NODE_ENV"] = "production"
        env["PORT"] = PORT
        env["HOSTNAME"] = "0.0.0.0"
        env["PATH"] = (
            "/home/z/.bun/bin:/home/z/.npm-global/bin:/usr/local/bin:"
            "/usr/bin:/bin:."
        )
        with open(LOG, "ab", 0) as log:
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
        # Exec bun DIRECTLY (not via env): `env` would try to exec server.js
        # itself, which lacks the +x bit ("Permission denied"). bun takes the
        # script path as an operand and does not need it executable.
        os.execve("/usr/local/bin/bun", ["bun", SERVER], env)
    os._exit(0)

os.waitpid(pid, 0)
print(f"production server daemonized on :{PORT} (log: {LOG})")

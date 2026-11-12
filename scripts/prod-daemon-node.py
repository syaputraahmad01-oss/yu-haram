#!/usr/bin/env python3
"""Double-fork launcher for the PRODUCTION standalone server using NODE.

Why node and not bun: undici 8.12.4 (bundled into the server chunks via
src/lib/security/ssrf.ts) requires worker_threads.markAsUncloneable, which
Node >= 23 implements but Bun 1.3.x does not — `bun .next/standalone/server.js`
crashes at module evaluation ("util.markAsUncloneable is not a function").
Node is the officially supported runtime for Next.js standalone output.

Same survival technique as scripts/dev-daemon.py: double-fork re-parents the
server to PID 1 so it stays alive between tool calls.

Usage:  python3 scripts/prod-daemon-node.py [port]   (default 3000)
Stop:   node rewrites the process title to "next-server (v16.1.3)", so
        `pkill -f 'standalone/server.js'` does NOT match — kill by the
        listening pid: kill $(ss -tlnp | grep :3000 ...) or pkill -f next-server
        (careful: the dev server uses the same title).
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
        os.execv("/usr/bin/env", ["env", "node", SERVER])
        os._exit(1)
    os._exit(0)
os.waitpid(pid, 0)
print(f"production server (node) daemonized on :{PORT} (log: {LOG})")

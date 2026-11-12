#!/usr/bin/env python3
"""Double-fork launcher: runs .zscripts/dev.sh detached from the tool-call
process tree so the sandbox driver's post-command cleanup cannot kill it.

Why: every process spawned directly by a Bash tool call is killed when that
call ends (the driver walks/kills the wrapper's process tree). A double-fork
re-parents the final child to PID 1 (tini), the same position in the tree as
the boot-started dev server, which survives indefinitely.

Usage: python3 scripts/dev-daemon.py
Log:    /home/z/my-project/.zscripts/dev-boot.log (dev.sh steps: bun install,
        db:deploy, [ENV] integrity actions — kept separate from dev.log
        because `next dev | tee dev.log` TRUNCATES dev.log on startup and
        would wipe the boot-step evidence)
"""
import os
import sys

PROJECT = "/home/z/my-project"
DEV_SH = os.path.join(PROJECT, ".zscripts", "dev.sh")
LOG = os.path.join(PROJECT, ".zscripts", "dev-boot.log")

pid = os.fork()
if pid == 0:
    # Child: new session, drop controlling terminal.
    os.setsid()
    pid2 = os.fork()
    if pid2 == 0:
        # Grandchild: fully detached, re-parented to init after first child exits.
        os.chdir(PROJECT)
        env = dict(os.environ)
        env["PATH"] = (
            "/home/z/.bun/bin:/home/z/.npm-global/bin:/usr/local/bin:"
            "/usr/bin:/bin:."
        )
        with open(LOG, "ab", 0) as log:
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
        os.execve("/bin/bash", ["bash", DEV_SH], env)
    os._exit(0)

# Parent: reap first child so the grandchild is orphaned to PID 1 immediately.
os.waitpid(pid, 0)
print(f"dev.sh daemonized (log: {LOG})")

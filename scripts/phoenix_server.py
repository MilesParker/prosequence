#!/usr/bin/env python3
"""Launch the local Phoenix trace collector + UI (Directive: local trace
observability). Localhost only, SQLite-backed, no egress.

    python3 scripts/phoenix_server.py       # serves http://localhost:6006

Wraps `python -m phoenix.server.main serve` so the launch matches the repo's
scripts/*.py convention. This is an AUXILIARY local process, not a runtime
dependency of the harness: roles.run runs identically whether or not
this is up — spans just fail to export (non-blockingly) while it is down.

Phoenix keeps its SQLite store under PHOENIX_WORKING_DIR (default ~/.phoenix).
Stop with Ctrl-C.
"""
import os
import sys


def main() -> int:
    # exec so signals (Ctrl-C) go straight to the server process.
    os.execvp(sys.executable, [sys.executable, "-m", "phoenix.server.main", "serve"])
    return 0  # unreachable


if __name__ == "__main__":
    raise SystemExit(main())

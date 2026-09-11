#!/usr/bin/env python3
"""Runtime output paths, defined once.

`logs/` used to sit at the repo root, and three modules computed their way to
it independently — `guarded_client` for the token log, `salvage` for failed-run
error corpora, `collect` for run reports — each with its own three-deep
`os.path.dirname` chain off `__file__`. Three copies of a path root is how the
next move breaks two of them silently, so the root lives here and they import
it.

It sits INSIDE the package: `prosequence/logs/`, not the repo root. Runtime
output belongs to the harness that produces it, and a package-relative path
survives being imported from a working directory that is not the repo root —
which is how these roles are actually driven (a Python console, an IDE run
config). The one thing still resolved against the process cwd is the kill file
(`STOP`), deliberately: it is a signal from whoever is watching the run, not
output from it.

The directory is tracked and its contents are not — `prosequence/logs/.gitignore`
ignores everything but itself, so the path exists in a fresh clone while nothing
written into it is ever committed.
"""
from __future__ import annotations

import os

PKG_DIR = os.path.dirname(os.path.abspath(__file__))          # prosequence/
REPO_ROOT = os.path.dirname(PKG_DIR)                          # outer repo root

#: Root for every runtime artefact: the token log, failed-run error corpora,
#: collection run reports. Subdirectories are named by the modules that own
#: them; the directories themselves are created on demand at write time.
LOG_DIR = os.path.join(PKG_DIR, "logs")

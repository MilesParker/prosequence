#!/usr/bin/env python3
"""Run every suite: `python -m prosequence.tests`.

Each suite's `main()` prints its own PASS/FAIL lines and returns 0 on success.
This runs all of them and exits non-zero if any suite failed.
"""
from __future__ import annotations

import sys

from prosequence.tests import test_1d, test_1e, test_role

SUITES = [
    ("1d — writer session & store", test_1d),
    ("1e — stop controls", test_1e),
    ("role — ingestion role & capability", test_role),
]


def main() -> int:
    rc = 0
    for label, mod in SUITES:
        print(f"\n{'=' * 60}\n== {label}\n{'=' * 60}")
        rc |= mod.main()
    print(f"\n{'=' * 60}")
    print("ALL SUITES PASSED" if rc == 0 else "SOME SUITES FAILED")
    return rc


if __name__ == "__main__":
    sys.exit(main())

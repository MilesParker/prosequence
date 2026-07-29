#!/usr/bin/env python3
"""Rewrite the three corpora in place through the canonical load/serialize pair.

This is the one large, intentional formatting diff. Everything after this is
minimal-diff: a change to one node touches only that node's lines.

Comments are NOT preserved — the emitter neither reads nor writes them. Run
`grep -n '#' discourse-spaces/*.v2.yaml` before canonicalizing; anything found
will be destroyed.
"""
import sys

from parsanga_io import load, serialize

CORPORA = (
    "discourse-spaces/free-transit.v2.yaml",
    "discourse-spaces/gaza.v2.yaml",
    "discourse-spaces/freedman.v2.yaml",
)


def canonicalize(path: str) -> None:
    text = serialize(load(path))
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print(f"canonicalized {path} ({len(text)} bytes)")


def main(argv):
    paths = argv or list(CORPORA)
    for p in paths:
        canonicalize(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

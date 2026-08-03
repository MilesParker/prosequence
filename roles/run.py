#!/usr/bin/env python3
"""Harness entry for the ingestion role.

Wires the run-time dependencies and hands (url, document_text) to the role:

    config -> guard + session -> IngestionRole.run(url, document_text)
           -> land the commit on its own branch

Model and iteration cap come from the guard config. The role commits, once,
outside the graph; the injection then lands that commit on its own branch and
rewinds main (see `_land_on_branch`) — the store only advances refs/heads/main,
so "on a branch, not main" is honoured here, in the injection's own git.

`run()` is the programmatic harness API; a stub client with the same
`.messages.create` surface can be passed to exercise the plumbing without the
API. `main` is a thin CLI over it — it requires BOTH the reference url and a
document (read from a file), because the reference is a run parameter, never
inferred.
"""
from __future__ import annotations

import os
import sys

import anthropic
import pygit2

from corpus_store import CorpusStore
from guarded_client import GuardConfig, GuardedClient
from session import Session

from .ingestion import IngestionRole
from .observability import init_tracing

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS_DIR = os.path.join(REPO_ROOT, "discourse-spaces")
GUARD_CONFIG = os.path.join(REPO_ROOT, "guard_config.toml")


def _land_on_branch(store: CorpusStore, head0: str, new_sha: str,
                    corpus_file: str) -> str:
    """Move the just-made commit off main onto its own branch and rewind main to
    `head0`, leaving the working tree clean.

    The store only advances refs/heads/main (hard-coded, and left untouched), so
    landing the injection on a branch rather than main happens here, after the
    commit. Rollback is `git -C discourse-spaces branch -D <branch>`.
    """
    repo = store.repo
    branch = f"ingest/{new_sha[:8]}"
    repo.references.create(f"refs/heads/{branch}", new_sha, force=True)
    repo.references["refs/heads/main"].set_target(head0)
    # Restore the working tree + index to head0's blob so `git status` is clean
    # and a subsequent run's WorkingTreeDirty guard still passes.
    head0_commit = repo[head0].peel(pygit2.Commit)
    blob = head0_commit.tree[corpus_file]
    with open(os.path.join(store.workdir, corpus_file), "wb") as fh:
        fh.write(repo[blob.id].data)
    repo.index.read_tree(head0_commit.tree)
    repo.index.write()
    return branch


def run(url: str, document_text: str, *, corpus_name: str = "free-transit",
        client=None, commit_summary: str | None = None) -> dict:
    """Ingest one document into `corpus_name` and commit. Returns the role's
    report dict (sha, ops, op_lines, diff, iterations, tokens).

    `client` defaults to a real anthropic.Anthropic() (reads ANTHROPIC_API_KEY);
    pass a stub with the same `.messages.create` surface to run without the API.
    """
    # Observability: register the tracer provider + auto-instrumentation before
    # the Anthropic client and the graph are constructed. Idempotent; a no-op
    # when Phoenix/openinference are absent or PARSANGA_TRACE=0. Orthogonal to
    # the commit path — never gates a run.
    init_tracing()

    corpus_file = f"{corpus_name}.v2.yaml"
    store = CorpusStore(CORPUS_DIR)
    head0 = store.head()  # captured before the session binds, for the rewind
    # The store/session key a corpus by its full blob name, not the bare slug.
    session = Session(store, corpus_file)

    if client is None:
        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the env
    config = GuardConfig.load(GUARD_CONFIG)
    guard = GuardedClient(client, config, corpus_file)

    role = IngestionRole(
        guard=guard,
        session=session,
        model=config.model,
        iteration_cap=config.iteration_cap,
    )
    report = role.run(url, document_text, commit_summary=commit_summary)
    # The role committed onto main (the store's only ref); land it on its own
    # branch and rewind main, in the injection's own git.
    report["branch"] = _land_on_branch(store, head0, report["sha"], corpus_file)
    return report


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python -m roles.run <reference_url> <document_file>",
              file=sys.stderr)
        return 2
    reference, doc_path = argv[0], argv[1]
    with open(doc_path, "r", encoding="utf-8") as fh:
        document_text = fh.read()

    report = run(reference, document_text)
    print(f"commit:     {report['sha']}")
    print(f"branch:     {report['branch']}")
    print(f"iterations: {report['iterations']}")
    print(f"tokens:     {report['tokens']}")
    print("ops:")
    for op in report["op_lines"]:
        print(f"  {op}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

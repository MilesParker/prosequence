#!/usr/bin/env python3
"""Harness entry for the ingestion role.

Wires the run-time dependencies and hands (url, document_text) to the role:

    config -> guard + session -> IngestionRole.run(url, document_text)
           -> land the commit on its own branch

Model and iteration cap come from the guard config. The role commits, once,
outside the graph; the injection then lands that commit on its own branch and
rewinds main (see `_land_on_branch`) — the store only advances refs/heads/main,
so "on a branch, not main" is honoured here, in the injection's own git.

`run()` is the primitive programmatic harness API: it requires BOTH a reference
url and a document, and the corpus must already exist. `ingest()` is a
convenience over it — it accepts a url and/or document_text, fetches the page
when no text is supplied, and seeds the corpus when it does not exist. Both
fetching and corpus creation are deterministic harness steps: only the
text->graph transform is the model's. A stub client with the same
`.messages.create` surface can be passed to either to exercise the plumbing
without the API. `main` is a thin CLI over `run()` — it requires both the
reference url and a document (read from a file), because the reference is a run
parameter, never inferred.
"""
from __future__ import annotations

import os
import sys
import uuid
from html.parser import HTMLParser

import anthropic
import pygit2
import requests
import trafilatura

from ..core.corpus_store import CorpusStore
from ..core.guarded_client import GuardConfig, GuardedClient
from ..core.session import Session
from ..core.yaml_io import Claim, Corpus, serialize

from .ingestion import IngestionRole
from .observability import init_tracing

PKG_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # prosequence/
REPO_ROOT = os.path.dirname(PKG_DIR)                                   # outer repo root
CORPUS_DIR = os.path.join(REPO_ROOT, "discourse-spaces")
GUARD_CONFIG = os.path.join(PKG_DIR, "guard_config.toml")

# A plausible browser UA; many sites reject the default python-requests agent.
_FETCH_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
             "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def _load_env() -> None:
    """Load REPO_ROOT/.env into the environment before the client is built, so
    ANTHROPIC_API_KEY (and any ANTHROPIC_BASE_URL) can live in a gitignored .env
    that a shell export or an IDE run-config need not supply. Soft: a no-op when
    python-dotenv is absent or the file is missing. Real env vars already set win
    (load_dotenv's override=False default), so an explicit export is never
    clobbered."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(os.path.join(REPO_ROOT, ".env"))


def _reset_main_to(store: CorpusStore, head0: str, corpus_file: str) -> None:
    """Point refs/heads/main at `head0` and make the working tree + index match
    it for `corpus_file`: restore head0's blob, or delete the file if
    `corpus_file` did not exist at head0 (it was seeded in this run and head0
    predates it). Shared by `_land_on_branch` (after branching off a successful
    commit) and `ingest()`'s failure path (a seed commit that a subsequent
    ingestion failure must not leave stranded on main — see `ingest()`)."""
    repo = store.repo
    repo.references["refs/heads/main"].set_target(head0)
    head0_commit = repo[head0].peel(pygit2.Commit)
    path = os.path.join(store.workdir, corpus_file)
    if corpus_file in head0_commit.tree:
        blob = head0_commit.tree[corpus_file]
        with open(path, "wb") as fh:
            fh.write(repo[blob.id].data)
    elif os.path.exists(path):
        os.remove(path)
    repo.index.read_tree(head0_commit.tree)
    repo.index.write()


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
    _reset_main_to(store, head0, corpus_file)
    return branch


class _TextExtractor(HTMLParser):
    """Naive HTML -> text fallback for when trafilatura's boilerplate-removal
    heuristics find nothing extractable (e.g. a non-article page): drop
    script/style/head, break on block tags, keep the data. No boilerplate
    stripping of its own — nav/ads/footers survive — so this stays honest about
    being crude rather than pretending to be article extraction."""

    _SKIP = {"script", "style", "head", "noscript", "template"}
    _BLOCK = {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
              "tr", "section", "article", "header", "footer", "blockquote"}

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag in self._BLOCK:
            self._parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        lines = ("".join(self._parts)).splitlines()
        out: list[str] = []
        for ln in (ln.strip() for ln in lines):
            if ln or (out and out[-1]):  # collapse runs of blank lines
                out.append(ln)
        return "\n".join(out).strip()


def _fetch_text(url: str) -> str:
    """Fetch `url` and reduce it to plain article text. Deterministic harness
    I/O — the model never fetches. trafilatura does the boilerplate removal
    (nav/ads/footers/comments stripped, main content kept); when its heuristics
    find no extractable article (e.g. a listing or non-article page) this falls
    back to the naive block-tag splitter, which keeps everything rather than
    nothing. Raises on an HTTP error or an empty extraction from both."""
    resp = requests.get(url, headers={"User-Agent": _FETCH_UA}, timeout=30)
    resp.raise_for_status()
    text = trafilatura.extract(resp.text, include_comments=False, include_tables=False)
    if not text:
        parser = _TextExtractor()
        parser.feed(resp.text)
        text = parser.text()
    if not text:
        raise ValueError(f"fetched {url!r} but extracted no text from the page")
    return text


def _tag_from(text: str, limit: int = 50) -> str:
    """Derive a claim tag from its text: truncate at `limit` chars on a word
    boundary (never mid-word), capitalized initial — matching the "TAGS NAME
    CONTENT" rule in prompt.py. Used only for the seed root claim; a model
    finding supplies its own tags."""
    text = text.strip()
    tag = text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0]
    return tag[:1].upper() + tag[1:] if tag else tag


def _seed_corpus(store: CorpusStore, corpus_file: str, corpus_id: str,
                 title: str, root_claim: str) -> str:
    """Commit a corpus seeded with exactly one claim — the root, `root_claim`'s
    text — onto main, and return the new sha. Deterministic — no model.

    A corpus with zero claims has nothing for ingestion to attach to: I3
    ("attach to existing uuids") is vacuous, and in practice a model handed an
    empty corpus produces a flat, disconnected claim list instead of a DAG
    rooted at anything. The root claim is what "the existing corpus" means for
    the very first document — the thesis/question everything else attaches to,
    same as every hand-authored corpus (see e.g. free-transit.v2.yaml's root
    "Fares should be removed from public transit"). `render_corpus` flags it
    `"root": true` so the model can tell it apart from an ordinary claim."""
    root = Claim(id=str(uuid.uuid7()), tag=_tag_from(root_claim), text=root_claim,
                terminal=False, uncertain=False, submissionStatus="Accepted",
                attribution=None)
    seeded = Corpus(id=corpus_id, title=title, definitions=(), roots=(root.id,),
                    claims=(root,), inferences=())
    return store.commit(
        corpus_file, serialize(seeded),
        f"genesis: seed corpus {corpus_id!r} (root: {root.tag!r})",
        parent_sha=store.head(),
    )


def _ingest_into(store: CorpusStore, head0: str, corpus_file: str,
                 reference: str, document_text: str, *,
                 client=None, commit_summary: str | None = None) -> dict:
    """Bind a session on `store`'s current head, run the ingestion role, then
    land the commit on its own branch and rewind main to `head0`. Shared core of
    `run()` and `ingest()`. `head0` is captured by the caller BEFORE any seed
    commit, so a seed lands on the branch alongside the ingest, not on main."""
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
    report = role.run(reference, document_text, commit_summary=commit_summary)
    # The role committed onto main (the store's only ref); land it on its own
    # branch and rewind main, in the injection's own git.
    report["branch"] = _land_on_branch(store, head0, report["sha"], corpus_file)
    return report


def run(url: str, document_text: str, *, corpus_name: str = "free-transit",
        client=None, commit_summary: str | None = None) -> dict:
    """Ingest one document into an existing `corpus_name` and commit. Returns the
    role's report dict (sha, ops, op_lines, diff, iterations, tokens).

    The primitive: both `url` (attribution reference) and `document_text` are
    required, and the corpus must already exist — no fetch, no creation. Use
    `ingest()` for the convenience variants. `client` defaults to a real
    anthropic.Anthropic() (reads ANTHROPIC_API_KEY); pass a stub with the same
    `.messages.create` surface to run without the API.
    """
    # Observability: register the tracer provider + auto-instrumentation before
    # the Anthropic client and the graph are constructed. Idempotent; a no-op
    # when Phoenix/openinference are absent or PROSEQUENCE_TRACE=0. Orthogonal to
    # the commit path — never gates a run.
    _load_env()
    init_tracing()

    corpus_file = f"{corpus_name}.v2.yaml"
    store = CorpusStore(CORPUS_DIR)
    head0 = store.head()  # captured before the session binds, for the rewind
    return _ingest_into(store, head0, corpus_file, url, document_text,
                        client=client, commit_summary=commit_summary)


def ingest(corpus_name: str, *, url: str | None = None,
           document_text: str | None = None, title: str | None = None,
           root_claim: str | None = None,
           client=None, commit_summary: str | None = None) -> dict:
    """Convenience entry over `run()`: ingest one document, fetching it when no
    text is given and seeding the corpus when it does not exist. Returns the same
    report dict as `run()`.

    Supply `url`, `document_text`, or both:
      * url only           — the page is fetched (naive HTML->text) and ingested;
                             the url is also the attribution reference.
      * document_text only — ingested as-is; attribution reads '(inline document)'.
      * both               — document_text is ingested; url is attribution only
                             (no fetch).

    If ``<corpus_name>.v2.yaml`` is absent it is seeded before ingesting — with
    exactly one claim, the root, whose text IS `root_claim` (required in that
    case; title defaults to `corpus_name`). A corpus with zero claims gives
    ingestion nothing to attach to (I3's "attach to existing uuids" is vacuous),
    which in practice produced a flat, disconnected claim list rather than a
    DAG — `root_claim` is the thesis/question the document's claims attach to
    instead. The seed and the ingest then land together on the ingest branch,
    leaving main untouched for review. Fetching and corpus creation are
    deterministic harness steps — only the text->graph transform is the model's.
    """
    _load_env()
    init_tracing()
    corpus_file = f"{corpus_name}.v2.yaml"
    store = CorpusStore(CORPUS_DIR)
    head0 = store.head()  # BEFORE any seed, so the seed lands on the branch

    # Fetch only when no text was supplied; an empty string counts as "not
    # supplied" (this is the trap the primitive run() does not catch).
    if not document_text:
        if not url:
            raise ValueError("supply document_text, url, or both")
        document_text = _fetch_text(url)
    reference = url if url else "(inline document)"

    seeded = corpus_file not in store.list_corpora()
    if seeded:
        if not root_claim:
            raise ValueError(
                f"corpus {corpus_name!r} does not exist; seeding a new corpus "
                f"needs root_claim — the thesis/question this corpus argues "
                f"about (e.g. 'Fares should be removed from public transit'), "
                f"the anchor the document's claims attach to")
        _seed_corpus(store, corpus_file, corpus_name, title or corpus_name, root_claim)

    if not seeded:
        return _ingest_into(store, head0, corpus_file, reference, document_text,
                            client=client, commit_summary=commit_summary)
    try:
        return _ingest_into(store, head0, corpus_file, reference, document_text,
                            client=client, commit_summary=commit_summary)
    except BaseException:
        # The seed above committed directly onto main (there is no branch to
        # land it on yet — that only happens on a *successful* ingest, inside
        # _ingest_into). If the ingest that was meant to follow it fails for any
        # reason, main must not end up sitting on an orphaned seed commit: roll
        # it back to head0, same as a successful run would have (via
        # _land_on_branch) if the ingest itself had failed to land.
        _reset_main_to(store, head0, corpus_file)
        raise


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python -m prosequence.roles.run <reference_url> <document_file>",
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

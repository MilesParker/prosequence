#!/usr/bin/env python3
"""What a failed run leaves behind: the graph it would have written, as a file.

A run that fails after the model has answered destroys expensive work. The
finding is one forced tool call — thousands of output tokens — and every gate
downstream of it (`apply._check_schemes`, `plan.check_plan`, the session's own
I1-I10 at commit) is terminal by design. Before this module the failure path
raised a message and nothing else survived: no corpus, no finding, and on the
seeded-corpus path in `run.ingest` even the genesis commit was rewound, so a
failed ingestion left the repo exactly as it found it. Diagnosis meant re-running
and re-spending.

This module writes the work out instead. On failure the plan is applied
BEST-EFFORT to the bound version and the result is serialized to an ERROR FILE:

    prosequence/logs/failed/<slug>.<utc>.<run>.error.v2.yaml

Three properties, each load-bearing:

  * It is a real v2 corpus. `yaml_io.load` reads it, `validate.check` runs over
    it, and the viz app opens it. That is the whole point of salvaging the graph
    rather than the raw finding: the failure is a graph-shaped problem (41
    unattached claims), and a graph is what you need in front of you to see it.
  * It is named an error and it lives in `prosequence/logs/`, gitignored in the
    outer repo and is not the corpus store. `discourse-spaces/` is its own git
    repo; nothing here ever writes there. An error file cannot be mistaken for a
    corpus, and cannot be picked up by `validate.py`'s three-corpus sweep.
  * It is byte-identical, below the header, to what would have been committed.
    So `diff <(git -C discourse-spaces show main:<slug>.v2.yaml) <error file>`
    shows exactly the nodes the run wanted to add.

The header is YAML comments, which `safe_load` discards — that is why the file
stays loadable while still announcing what it is on line one.

BEST-EFFORT is precise, not vague. The plan reaching this module is one that
`check_plan` refused, so it cannot be executed as written; salvage applies what
it can and RECORDS each thing it could not:

  * a `New` reference nothing binds     -> the inference is dropped, and noted
  * an `Existing` id not in the corpus  -> KEPT, dangling. It is the finding's
    actual mistake; writing it out is what makes the error file show I3 failing
    at that id rather than silently hiding it.
  * a node the model constructed wrong  -> dropped, with the constructor's own
    message (`Inference.__post_init__` enforces I1/I4/I9 at construction)

Ids minted here are fresh uuid7s that will never be committed. They exist so the
graph has identity to be read by; they are not the ids a successful run would
have produced, and the header says so.

Nothing in this module can commit, and it is never on the success path. A
salvage failure is swallowed by `capture()` — a diagnostic that breaks a run is
worse than no diagnostic.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence

from ..core import ops as _ops
from ..core.types import Corpus
from ..paths import LOG_DIR, REPO_ROOT
from ..core.yaml_io import serialize
from .plan import AddClaim, AddInference, DesignateThesis, Existing, Op, Ref

# `prosequence/logs/failed`, beside the token log. Not a config key (see
# guarded_client's DEFAULT_TOKEN_LOG for the same reasoning); the directory is
# created on demand.
FAILED_DIR = os.path.join(LOG_DIR, "failed")

# The viewer's unmanaged root (see src/config.ts). Gitignored and invisible to
# the store and the validator, so writing here can never dirty the corpus repo
# or affect a later commit.
SCRATCH_DIR = os.path.join(REPO_ROOT, "discourse-spaces", "scratch")

_BANNER = "FAILED RUN — NOT A CORPUS. Do not copy this into discourse-spaces/."


# --------------------------------------------------------------------------
# Best-effort application
# --------------------------------------------------------------------------

def _resolve(ref: Ref, env: dict) -> str:
    """A plan reference to the id it names, for salvage only.

    Differs from `plan.resolve` in exactly one way, and deliberately: an
    `Existing` id is returned WITHOUT checking it against the corpus. Salvage's
    job is to show what the finding asked for, and a reference to a node that
    does not exist is one of the things worth seeing.
    """
    if isinstance(ref, Existing):
        return str(ref.id)
    bound = env.get(ref.key)
    if bound is None:
        raise KeyError(ref.key)
    return bound


def apply_plan(
    bound: Corpus,
    plan: Sequence[Op],
    *,
    skip: frozenset = frozenset(),
) -> tuple[Corpus, list[str], dict[int, str]]:
    """Apply `plan` to `bound` purely, as far as it goes, skipping `skip`.

    Returns (corpus, notes, id_by_index): the graph, what could not be applied
    and why, and the id minted for each op index. That third value is what makes
    this reusable — `roles/repair.py` predicts a plan's graph, reads violations
    off it, and has to map a violating NODE back to the OP that produced it.
    Op indices are stable across dry runs in a way minted ids are not, which is
    why they, not ids, are what repair decides with.

    Ids minted here are never committed. The session mints its own when the
    (possibly repaired) plan is finally executed; only the graph's SHAPE carries
    over, which is all any invariant depends on.
    """
    version = bound
    env: dict[str, str] = {}
    notes: list[str] = []
    id_by_index: dict[int, str] = {}

    for n, op in enumerate(plan):
        if n in skip:
            continue
        if isinstance(op, AddClaim):
            cid = str(uuid.uuid7())
            version = _ops.add_claim(
                version, id=cid, text=op.text, tag=op.tag,
                attribution=op.attribution, terminal=op.terminal)
            env[op.key] = cid
            id_by_index[n] = cid
        elif isinstance(op, AddInference):
            try:
                grounds = [_resolve(g, env) for g in op.grounds]
                warrants = [_resolve(w, env) for w in op.warrants]
                target = _resolve(op.target, env)
            except KeyError as exc:
                notes.append(
                    f"op[{n}] AddInference dropped: reference {exc.args[0]!r} "
                    f"is a plan key that no op in the plan creates")
                continue
            iid = str(uuid.uuid7())
            try:
                version = _ops.add_inference(
                    version, id=iid, grounds=grounds,
                    warrants=warrants, target=target, relation=op.relation,
                    scheme=op.scheme, scheme_descriptor=op.scheme_descriptor)
            except ValueError as exc:
                # Inference.__post_init__ enforces I1/I4/I9 at construction, so
                # a malformed node cannot be built at all — not even here.
                notes.append(f"op[{n}] AddInference dropped: {exc}")
            else:
                id_by_index[n] = iid
        elif isinstance(op, DesignateThesis):
            # Mints nothing, so it contributes no entry to id_by_index — which
            # is also why repair can never choose it as a drop candidate, and
            # never needs to: `check_plan` has already bound every ref, so the
            # one violation a designation could raise (I3, an unresolvable
            # thesis) cannot arise from a plan that reaches here.
            try:
                version = _ops.designate_thesis(version, id=_resolve(op.target, env))
            except KeyError as exc:
                notes.append(
                    f"op[{n}] DesignateThesis dropped: reference {exc.args[0]!r} "
                    f"is a plan key that no op in the plan creates")
        else:
            notes.append(
                f"op[{n}] {type(op).__name__} not applied "
                f"(salvage covers AddClaim, AddInference and DesignateThesis)")

    return version, notes, id_by_index


def salvage_corpus(bound: Corpus, plan: Sequence[Op]) -> tuple[Corpus, list[str]]:
    """`apply_plan` for the error-file path: the graph plus what is missing
    from it. The id-provenance caveat is stated in the notes rather than left to
    be inferred, since a reader of the file has no other way to know."""
    version, notes, _ = apply_plan(bound, plan)
    return version, [
        "new-node ids were minted by salvage, not by the session — they are "
        "readable identities for this file, not the ids the run would have "
        "committed",
        *notes,
    ]


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------

def _slug(corpus_file: str) -> str:
    """`china-ai.v2.yaml` -> `china-ai`. The error file re-adds `.v2.yaml` after
    its own marker, so the result is loadable without ever colliding with the
    corpus store's naming."""
    base = os.path.basename(corpus_file)
    return base[:-len(".v2.yaml")] if base.endswith(".v2.yaml") else base


def _stem(corpus_file: str, run_id: str, when: datetime) -> str:
    return (f"{_slug(corpus_file)}."
            f"{when.strftime('%Y%m%dT%H%M%SZ')}.{run_id[:8]}.error")


def _header(lines: Sequence[str]) -> str:
    """Comment block. `yaml.safe_load` discards it, so the file stays a
    loadable corpus while announcing on line one that it is not one."""
    out = [f"# {_BANNER}"]
    for line in lines:
        for physical in str(line).splitlines() or [""]:
            out.append(f"# {physical}".rstrip())
    return "\n".join(out) + "\n"


def write_error_corpus(
    corpus: Corpus,
    *,
    corpus_file: str,
    run_id: str,
    stage: str,
    error: BaseException,
    bound_head: Optional[str] = None,
    notes: Sequence[str] = (),
    finding: Optional[dict] = None,
) -> str:
    """Write the error corpus (and, when given, the raw finding beside it).

    Returns the path of the corpus file. The finding is written as a sibling
    `.finding.json` because it is the irreplaceable artifact — the corpus can be
    rebuilt from it, and it cost the run's whole output budget to produce.
    """
    when = datetime.now(timezone.utc)
    os.makedirs(FAILED_DIR, exist_ok=True)
    stem = _stem(corpus_file, run_id, when)
    path = os.path.join(FAILED_DIR, f"{stem}.v2.yaml")

    meta = [
        "",
        f"corpus:  {corpus_file}",
        f"bound:   {bound_head or '(unknown)'}",
        f"run:     {run_id}",
        f"when:    {when.isoformat()}",
        f"stage:   {stage}",
        "",
        "failure:",
        *[f"  {ln}" for ln in f"{type(error).__name__}: {error}".splitlines()],
    ]
    if notes:
        meta += ["", f"notes ({len(notes)}):", *[f"  - {n}" for n in notes]]
    if finding is not None:
        meta += ["", f"finding: {stem}.finding.json"]
    meta += ["", "Nothing below this line was committed."]

    body = serialize(corpus)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(_header(meta))
        fh.write(body)

    # Second copy under a STABLE name the viewer can reach, so looking at a
    # failure is one URL rather than a hunt through timestamped filenames:
    # `?scratch=<slug>-failed`. The timestamped file above is the archive and
    # accumulates; this one is always the most recent failure for that corpus.
    # Header included — a file that does not announce itself as a failed run is
    # exactly what should not be sitting in the corpus directory.
    try:
        os.makedirs(SCRATCH_DIR, exist_ok=True)
        with open(os.path.join(SCRATCH_DIR,
                               f"{_slug(corpus_file)}-failed.v2.yaml"),
                  "w", encoding="utf-8") as fh:
            fh.write(_header(meta))
            fh.write(body)
    except OSError:
        pass  # the archive copy above is what matters; this is convenience

    if finding is not None:
        with open(os.path.join(FAILED_DIR, f"{stem}.finding.json"),
                  "w", encoding="utf-8") as fh:
            json.dump(finding, fh, indent=2, sort_keys=True, default=str)

    return path


def write_finding_only(
    *, corpus_file: str, run_id: str, stage: str, error: BaseException,
    finding: dict,
) -> str:
    """The fallback for a failure with no plan to apply — a finding malformed
    enough that no ops were built from it (`FindingShapeError`). There is no
    graph to salvage, so only the finding is written."""
    when = datetime.now(timezone.utc)
    os.makedirs(FAILED_DIR, exist_ok=True)
    path = os.path.join(
        FAILED_DIR, f"{_stem(corpus_file, run_id, when)}.finding.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(
            {"_banner": _BANNER, "corpus": corpus_file, "run": run_id,
             "when": when.isoformat(), "stage": stage,
             "failure": f"{type(error).__name__}: {error}",
             "finding": finding},
            fh, indent=2, sort_keys=True, default=str)
    return path


def capture(write, *, label: str) -> Optional[str]:
    """Run a writer, report where it landed, and never let it break the run.

    Salvage is diagnostics. A diagnostic that raises replaces a clear terminal
    error with a confusing one, so anything that goes wrong in here is reported
    to stderr and swallowed; the original failure propagates untouched.
    """
    import sys
    try:
        path = write()
    except Exception as exc:  # diagnostics must never mask the real failure
        print(f"[salvage] could not write {label}: "
              f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return None
    print(f"[salvage] {label} written to {path}", file=sys.stderr)
    return path

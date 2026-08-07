#!/usr/bin/env python3
"""Directive 1d / 1d2 checks — the writer session and store, end to end.

Each check in the directive is a function here; `main` runs them and reports
PASS/FAIL per line. Session-behaviour checks run against an isolated temp copy
of the corpus repo (`fresh_store`); the history invariant and the real-repo
session check run against the real store.

Since the 1d2 genesis rebuild, the real store's genesis carries the
target/relation form, so `fresh_store`'s "advance" step is a no-op (the copy is
already clean) and each temp session binds that genesis directly.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import uuid

import yaml

from prasanga.core.corpus_store import CorpusStore, HeadMoved, WorkingTreeDirty
from prasanga.core.yaml_io import ArgumentScheme, Relation, load, serialize
from prasanga.core.validate import check
from prasanga.core.session import Session, ValidationFailed, SessionClosed

CORPUS = "freedman.v2.yaml"
# Repo root is three dirs up (prasanga/tests/test_1d.py), where discourse-spaces
# lives — independent of the process working directory.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "discourse-spaces")


def _git(tmp, *args):
    return subprocess.run(
        ["git", "-C", tmp, *args], capture_output=True, text=True, check=True
    )


def fresh_store():
    """Temp copy of the corpus repo, HEAD advanced to the assumed 1a2 form."""
    tmp = tempfile.mkdtemp(prefix="parsanga-1d-")
    dst = os.path.join(tmp, "discourse-spaces")
    shutil.copytree(SRC, dst)
    # Advance HEAD to the working-tree (target/relation) form, clean tree.
    _git(dst, "-c", "user.name=genesis", "-c", "user.email=g@local", "add", "-A")
    if _git(dst, "status", "--porcelain").stdout.strip():
        _git(
            dst, "-c", "user.name=genesis", "-c", "user.email=g@local",
            "commit", "-m", "genesis: 1a2 target/relation form",
        )
    return CorpusStore(dst), dst


# --------------------------------------------------------------------------
# Checks. Each returns (ok: bool, detail: str).
# --------------------------------------------------------------------------

def check_build_and_diff():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    cid = s.add_claim("Free transit raised ridership.", "riders-up")
    iid = s.add_inference(
        grounds=[next(iter(s.bound_version.claims)).id],
        warrants=[],
        target=cid,
        relation=Relation.CONCLUDES,
        scheme=ArgumentScheme.DEDUCTIVE,
    )
    sha = s.commit("add one claim and a concluding inference")
    ns = _git(dst, "show", "--numstat", "--format=", "HEAD", "--", CORPUS).stdout
    added, deleted, _ = ns.split()[:3]
    # Confirm the two new uuids are the only ids appearing in the added lines.
    patch = _git(dst, "show", "--format=", "HEAD", "--", CORPUS).stdout
    added_ids = {cid, iid}
    ok = int(deleted) == 0 and all(i in patch for i in added_ids)
    return ok, f"+{added} -{deleted} lines; new claim+inference only (sha {sha[:12]})"


def check_read_your_writes():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    cid = s.add_claim("Uncommitted claim.", "ryw")
    seen_in_session = s.get(cid) is not None
    # Same id read from head via the store, before commit: not present.
    head_corpus = load(store.read(CORPUS, store.head()))
    absent_at_head = head_corpus.node(cid) is None
    ok = seen_in_session and absent_at_head
    return ok, f"in-session get -> {seen_in_session}; at head -> absent {absent_at_head}"


def check_midsession_violation_deferred():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = s.add_claim("A ground.", "g")
    # Inference targeting an id that is never added: invalid (I3) but must not
    # raise now — reads keep working.
    dangling = str(uuid.uuid7())
    raised_during_build = False
    try:
        iid = s.add_inference([g], [], dangling, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
        _ = s.get(iid)
        _ = s.neighborhood(iid, 2)
    except Exception:
        raised_during_build = True
    committed_fine = None
    try:
        s.commit("should fail I3")
    except ValidationFailed as e:
        committed_fine = any("I3" in v for v in e.violations)
    ok = (not raised_during_build) and committed_fine
    return ok, f"no raise mid-build={not raised_during_build}; I3 at commit={committed_fine}"


def check_no_warrant_is_valid():
    """Directive/model note: an inference with no warrant is VALID (warrants are
    0..*). This commits successfully, contradicting the directive's 'no warrant
    -> ValidationFailed' line; see the report."""
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = s.add_claim("Ground for a warrantless inference.", "g")
    t = s.add_claim("Target claim.", "t")
    s.add_inference([g], [], t, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    try:
        sha = s.commit("warrantless inference")
        return True, f"committed cleanly (sha {sha[:12]}) — empty warrants are valid"
    except ValidationFailed as e:
        return False, f"unexpectedly rejected: {e.violations}"


def check_validation_failure_kills_session():
    """A genuine invariant violation (I2: concludes a terminal claim) at commit:
    ValidationFailed, no commit, session dead, further ops raise."""
    store, dst = fresh_store()
    head_before = store.head()
    s = Session(store, CORPUS)
    g = s.add_claim("Ground.", "g")
    term = s.add_claim("Bedrock value.", "term", terminal=True)
    s.add_inference([g], [], term, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    failed = False
    try:
        s.commit("concludes a terminal claim")
    except ValidationFailed as e:
        failed = any("I2" in v for v in e.violations)
    no_commit = store.head() == head_before
    dead = False
    try:
        s.add_claim("after death", "x")
    except SessionClosed:
        dead = True
    ok = failed and no_commit and dead
    return ok, f"I2 ValidationFailed={failed}; head unchanged={no_commit}; ops raise={dead}"


def check_head_moved():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    s.add_claim("Slow writer.", "slow")
    # Another session commits underneath, moving head.
    other = Session(store, CORPUS)
    g = next(iter(other.bound_version.claims)).id
    c = other.add_claim("Fast writer's claim.", "fast")
    other.add_inference([g], [], c, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    moved_head = other.commit("move head underneath the open session")
    head_after_other = store.head()
    raised = False
    try:
        s.commit("stale commit")
    except HeadMoved:
        raised = True
    no_extra_commit = store.head() == head_after_other
    dead = False
    try:
        s.get("anything")
    except SessionClosed:
        dead = True
    ok = raised and no_extra_commit and dead
    return ok, f"HeadMoved={raised}; no extra commit={no_extra_commit}; ops raise={dead}"


def check_working_tree_dirty():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    c = s.add_claim("A claim.", "c")
    s.add_inference([g], [], c, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    # A hand-edit lands on disk underneath the session.
    with open(os.path.join(dst, CORPUS), "a", encoding="utf-8") as fh:
        fh.write("\n# stray hand-edit\n")
    raised = False
    try:
        s.commit("commit over a dirty tree")
    except WorkingTreeDirty:
        raised = True
    return raised, f"WorkingTreeDirty raised={raised}"


def check_ops_after_commit_raise():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    c = s.add_claim("A claim.", "c")
    s.add_inference([g], [], c, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    s.commit("one and done")
    results = {}
    for name, fn in (
        ("add_claim", lambda: s.add_claim("x", "x")),
        ("get", lambda: s.get(c)),
        ("commit", lambda: s.commit("again")),
    ):
        try:
            fn()
            results[name] = False
        except SessionClosed:
            results[name] = True
    ok = all(results.values())
    return ok, f"raised after commit: {results}"


def check_relation_roundtrip():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    c_ok = s.add_claim("Concluded claim.", "cc")
    # A non-terminal claim to contest.
    c_att = s.add_claim("Contested claim.", "xx")
    i_con = s.add_inference([g], [], c_ok, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    i_cont = s.add_inference([g], [], c_att, Relation.CONTESTS, ArgumentScheme.DEDUCTIVE)
    sha = s.commit("one of each relation")
    reloaded = load(store.read(CORPUS, sha))
    con = reloaded.node(i_con)
    cont = reloaded.node(i_cont)
    ok = (
        con.relation == Relation.CONCLUDES and con.target == c_ok
        and cont.relation == Relation.CONTESTS and cont.target == c_att
    )
    return ok, f"concludes->{con.relation!r}@{con.target==c_ok}; contests->{cont.relation!r}@{cont.target==c_att}"


def check_relation_required_signature():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    c = s.add_claim("A claim.", "c")
    try:
        s.add_inference([g], [], c)  # type: ignore[call-arg]
        return False, "no TypeError — relation was defaulted"
    except TypeError as e:
        return True, f"TypeError (signature): {str(e)[:60]}"


def check_polarity_queries():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    target = s.add_claim("Shared target.", "shared")
    i_con = s.add_inference([g], [], target, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    i_cont = s.add_inference([g], [], target, Relation.CONTESTS, ArgumentScheme.DEDUCTIVE)
    con = [i.id for i in s.concludes(target)]
    cont = [i.id for i in s.contesting(target)]
    ok = con == [i_con] and cont == [i_cont]
    return ok, f"concludes={con==[i_con]} contesting={cont==[i_cont]}"


def check_revise_preserves():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    cid = s.add_claim("Original text.", "orig-tag")
    before = s.get(cid)
    s.revise_claim(cid, text="New text.")
    after = s.get(cid)
    ok = (
        after.id == cid  # uuid preserved
        and after.text == "New text."
        and after.tag == before.tag  # untouched field preserved
        and after.terminal == before.terminal
        and after.submissionStatus == before.submissionStatus
    )
    return ok, f"id kept={after.id==cid}; tag kept={after.tag==before.tag}; text changed={after.text=='New text.'}"


def check_bound_version_frozen():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    original_bytes = serialize(s.bound_version)
    cid = s.add_claim("A claim.", "c")
    s.revise_claim(cid, tag="c2")
    s.add_inference(
        [next(iter(s.bound_version.claims)).id], [], cid, Relation.CONCLUDES,
        ArgumentScheme.DEDUCTIVE,
    )
    after_bytes = serialize(s.bound_version)
    ok = after_bytes == original_bytes
    return ok, f"bound version bytes identical after ops={ok}"


def check_commit_message():
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    c1 = s.add_claim("Concluded.", "c-concl")
    c2 = s.add_claim("Contested.", "c-cont")
    s.add_inference([g], [], c1, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    s.add_inference([g], [], c2, Relation.CONTESTS, ArgumentScheme.DEDUCTIVE)
    s.revise_claim(c1, text="Concluded, revised.")
    sha = s.commit("mixed ops for the message")
    msg = _git(dst, "log", "-1", "--format=%B", sha).stdout
    checks = {
        "header": f"{CORPUS}: 5 ops — mixed ops for the message" in msg,
        "bound": "bound:" in msg,
        "add_claim tag": '"c-concl"' in msg and '"c-cont"' in msg,
        "concludes word": "concludes" in msg,
        "contests word": "contests" in msg,
        "revise field": "revise_claim" in msg and " text" in msg,
    }
    ok = all(checks.values())
    return ok, f"{checks}"


def check_bare_string_relation_raises():
    """Item 2: a plain string (even the correct "concludes") passed where a
    Relation is expected must raise — the type has to do work."""
    store, dst = fresh_store()
    s = Session(store, CORPUS)
    g = next(iter(s.bound_version.claims)).id
    c = s.add_claim("A claim.", "c")
    raised = False
    try:
        s.add_inference([g], [], c, "concludes",  # bare string, not Relation
                        ArgumentScheme.DEDUCTIVE)
    except (ValueError, TypeError):
        raised = True
    return raised, f"bare-string relation raises={raised}"


def check_all_commits_load_and_validate():
    """Item 4 invariant: every commit reachable from `main` in the REAL store —
    every corpus at each — must parse under the current loader and validate.
    This is the guard against a loader-unreadable commit (like the old genesis)
    entering the store again. No exemptions: every commit on main must load.

    The v2.3 genesis rebuild is what keeps that true. Making `scheme`
    non-nullable stranded the pre-v2.3 commits — the loader cannot read them and
    never will, since git history is immutable and no migration reaches
    backwards into it. Rather than carve out an exemption and leave a permanent
    hole here, main was rebuilt onto a new root at the migrated form (the same
    move the 1d2 genesis rebuild made, for the same reason). The stranded
    commits survive on the ingest/* and spike/* branches, which this walk does
    not visit.
    """
    store = CorpusStore(SRC)
    repo = store.repo
    shas = [str(c.id) for c in repo.walk(repo.head.target)]
    pairs = 0
    failures = []
    for sha in shas:
        for name in store.list_corpora(sha):
            text = store.read(name, sha)
            pairs += 1
            try:
                load(text)  # current loader must parse
            except Exception as e:
                failures.append(f"{sha[:8]}/{name} load: {e}")
                continue
            errs, _ = check(yaml.safe_load(text), name)
            if errs:
                failures.append(f"{sha[:8]}/{name}: {len(errs)} invariant errs")
    ok = not failures
    return ok, (
        f"{len(shas)} commit(s), {pairs} corpus-reads, all load+validate={ok}"
        + (f"; FAILURES={failures[:3]}" if failures else "")
    )


CHECKS = [
    ("build+diff shows only new nodes", check_build_and_diff),
    ("read-your-writes", check_read_your_writes),
    ("mid-session violation deferred to commit", check_midsession_violation_deferred),
    ("no-warrant inference is valid (model)", check_no_warrant_is_valid),
    ("validation failure kills session", check_validation_failure_kills_session),
    ("HeadMoved on stale commit", check_head_moved),
    ("WorkingTreeDirty on hand-edit", check_working_tree_dirty),
    ("ops after commit raise", check_ops_after_commit_raise),
    ("both relations round-trip", check_relation_roundtrip),
    ("missing relation is a signature error", check_relation_required_signature),
    ("polarity queries isolate polarity", check_polarity_queries),
    ("revise_claim preserves uuid+fields", check_revise_preserves),
    ("bound version stays frozen", check_bound_version_frozen),
    ("commit message renders ops+relations", check_commit_message),
    ("bare-string relation raises", check_bare_string_relation_raises),
    ("every commit loads+validates (store history)", check_all_commits_load_and_validate),
]


def main():
    passed = 0
    for label, fn in CHECKS:
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"EXCEPTION {type(e).__name__}: {e}"
        passed += ok
        print(f"[{'PASS' if ok else 'FAIL'}] {label}\n        {detail}")
    print(f"\n{passed}/{len(CHECKS)} checks passed")
    return 0 if passed == len(CHECKS) else 1


if __name__ == "__main__":
    sys.exit(main())

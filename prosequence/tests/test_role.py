#!/usr/bin/env python3
"""Role checks — the ingestion role end to end, and capability enforcement.

No API, no network: a scripted Anthropic-shaped stub drives the graph against an
isolated temp corpus repo (`fresh_store`). Each check is a function; `main` runs
them and reports PASS/FAIL per line. These exercise the promoted role's full
round trip (traverse -> finding -> apply -> commit) and prove capability is
enforced at apply, not by the prompt.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types

os.environ.setdefault("PROSEQUENCE_TRACE", "0")  # no exporter during tests

from prosequence.tests.test_1d import fresh_store, CORPUS
from prosequence.core.session import Session, ValidationFailed
from prosequence.core.yaml_io import load
from prosequence.core.guarded_client import GuardConfig, GuardedClient
from prosequence.roles.ingestion import IngestionRole
from prosequence.roles.capability import CapabilityError, check_capability
from prosequence.roles.plan import (
    AddClaim, AddInference, ClaimId, DesignateThesis, Existing, New, PlanError,
    ReviseClaim, check_plan,
    execute,
)


# --------------------------------------------------------------------------
# Anthropic-shaped stub — scripted content blocks + usage.
# --------------------------------------------------------------------------

def _block(**kw):
    return types.SimpleNamespace(**kw)


class _Usage:
    def __init__(self, i=100, o=40):
        self.input_tokens = i
        self.output_tokens = o
        self.cache_creation_input_tokens = 0
        self.cache_read_input_tokens = 0


class _Resp:
    def __init__(self, content, stop="end_turn"):
        self.content = content
        self.usage = _Usage()
        self.stop_reason = stop


class _StreamCtx:
    """The context manager `messages.stream(...)` returns — the surface the
    guard requires of an injected client (see guarded_client.create). Nothing
    here produces deltas because nothing there consumes them: the accumulated
    final message is the whole contract."""

    def __init__(self, resp):
        self._resp = resp

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self._resp


class StubClient:
    """Fake Anthropic client returning scripted responses (content + usage)."""

    def __init__(self, script):
        self._script = list(script)
        self.calls = 0
        self.messages = self  # so `client.messages.stream(...)` resolves here

    def stream(self, **kwargs):
        r = self._script[self.calls]
        self.calls += 1
        return _StreamCtx(r)


def _cfg(tmp, model="stub-model", iteration_cap=15):
    return GuardConfig(
        per_run_token_cap=10**9,
        cumulative_token_cap=10**9,
        cumulative_window_seconds=86400,
        kill_file=os.path.join(tmp, "STOP"),
        model=model,
        iteration_cap=iteration_cap,
    )


def _valid_finding(session) -> dict:
    """A minimal valid finding for CORPUS: one new attributive claim used as
    grounds, concluding an existing non-terminal, non-attributive claim. This is
    now the `submit_finding` tool's `input` dict directly — no text/fence."""
    target = next(c.id for c in session.bound_version.claims
                  if not c.terminal and c.attribution is None)
    return {
        "claims": [{
            "key": "c1", "tag": "Role test claim",
            "text": "A test assertion introduced by the document.",
            "terminal": False,
            "attribution": {"source": {"type": "Citation", "reference": "http://x"}, "quote": None},
        }],
        "inferences": [{
            "grounds": ["c1"], "warrants": [], "target": target, "relation": "concludes",
            # scheme is required on every inference; a descriptor rides with
            # Unknown and only with Unknown (the tool-boundary biconditional).
            "scheme": "Unknown", "schemeDescriptor": "report to fact",
        }],
    }


# --------------------------------------------------------------------------
# Checks. Each returns (ok, detail).
# --------------------------------------------------------------------------

def check_end_to_end():
    """Single-shot round trip: one finding turn, then apply + commit. No tool
    turn — the corpus is in front of the model, so it attaches in one call."""
    tmp = tempfile.mkdtemp(prefix="role-")
    store, dst = fresh_store()
    head0 = store.head()
    session = Session(store, CORPUS)

    script = [
        _Resp([_block(type="tool_use", name="submit_finding",
                      input=_valid_finding(session), id="t1")],
              stop="tool_use"),
    ]
    stub = StubClient(script)
    guard = GuardedClient(stub, _cfg(tmp), CORPUS,
                          token_log=os.path.join(tmp, "tok.jsonl"))
    role = IngestionRole(guard=guard, session=session,
                         model="stub-model", iteration_cap=15)

    report = role.run("http://x", "A document.")
    # The plan is the reified ops; op_lines is the session's own rendering.
    plan_ok = (len(report["plan"]) == 2
               and isinstance(report["plan"][0], AddClaim)
               and isinstance(report["plan"][1], AddInference))
    lines_ok = (len(report["op_lines"]) == 2
                and report["op_lines"][0].startswith("add_claim")
                and "concludes" in report["op_lines"][1])
    ok = (report["sha"] != head0 and report["iterations"] == 1
          and stub.calls == 1 and plan_ok and lines_ok
          and report["tokens"] == 140)
    return ok, (f"sha_advanced={report['sha'] != head0} iters={report['iterations']} "
                f"calls={stub.calls} plan={[type(o).__name__ for o in report['plan']]} "
                f"tokens={report['tokens']}")


def check_upward_thesis_commits():
    """A document that argues FROM the standing thesis to a further claim lands
    that claim as a NEW thesis, and the corpus commits.

    This is the whole upward path in one check, because every stage of it used
    to refuse: the finding had no way to spell the designation, ingestion held
    no op that could write `theses`, and a claim above the standing thesis
    validated only as a GAP-6 warning about an unconcluded orphan. What must
    hold now is that the new claim is IN `theses`, that the old one is still
    there beside it (designation appends, never replaces), and that the
    inference binding them survives to the commit."""
    tmp = tempfile.mkdtemp(prefix="role-thesis-")
    store, dst = fresh_store()
    session = Session(store, CORPUS)

    standing = session.bound_version.theses[0]
    finding = {
        "claims": [{
            "key": "t2", "tag": "Further question the document reaches",
            "text": "The consequent the standing thesis is a reason for.",
            "terminal": False, "thesis": True,
        }],
        "inferences": [{
            # The standing thesis as GROUNDS — the direction that was missing.
            "grounds": [standing], "warrants": [], "target": "t2",
            "relation": "concludes", "scheme": "FromConsequence",
        }],
    }
    script = [_Resp([_block(type="tool_use", name="submit_finding",
                            input=finding, id="t1")], stop="tool_use")]
    stub = StubClient(script)
    guard = GuardedClient(stub, _cfg(tmp), CORPUS,
                          token_log=os.path.join(tmp, "tok.jsonl"))
    role = IngestionRole(guard=guard, session=session,
                         model="stub-model", iteration_cap=15)
    report = role.run("http://x", "A document arguing past the thesis.")

    committed = load(store.read(CORPUS, report["sha"]))
    new_id = next(c.id for c in committed.claims if c.tag.startswith("Further"))
    designated = new_id in committed.theses
    kept_standing = standing in committed.theses
    bound = any(i.target == new_id and standing in i.grounds
                for i in committed.inferences)
    # The designation is an op in its own right, and the commit message says so.
    logged = any(l.startswith("designate_thesis") for l in report["op_lines"])

    ok = designated and kept_standing and bound and logged
    return ok, (f"designated={designated} kept_standing={kept_standing} "
                f"bound_by_inference={bound} in_op_lines={logged} "
                f"theses={len(committed.theses)}")


def check_designation_is_not_attachment():
    """A finding whose ONLY use of its new claims is designating them is still
    "nothing is attached", and still fatal.

    `DesignateThesis.attaches` is False for exactly this: `check_plan` counts a
    claim as attached when an inference binds it, not when an op merely names
    it. Were designation to count, one `thesis: true` in a finding of otherwise
    unconnected claims would launder the whole thing past the guard."""
    plan = (
        AddClaim(key="a", tag="A", text="a."),
        AddClaim(key="b", tag="B", text="b."),
        DesignateThesis(target=New("a")),
    )
    try:
        check_plan(plan, frozenset())
    except PlanError as exc:
        refused = "none of the 2 new claims is attached" in str(exc)
    else:
        refused = False
    return refused, f"designation_alone_refused={refused}"


def _looping_role(guard, session, iteration_cap):
    """A minimal role that binds one trivial tool and keeps calling it — the
    vehicle for exercising the harness iteration cap now that ingestion is
    single-shot and never loops. Reuses everything else from IngestionRole."""
    from langchain_core.tools import tool as _lc_tool

    class _LoopingRole(IngestionRole):
        def build_tools(self, _session):
            @_lc_tool
            def ping() -> str:
                """A no-op tool the model can call to keep the loop going."""
                return "pong"
            schema = [{"name": "ping", "description": "ping",
                       "input_schema": {"type": "object", "properties": {},
                                        "required": []}}]
            return [ping], schema

        def cached_context(self):
            return None  # no corpus needed to test the cap

    return _LoopingRole(guard=guard, session=session,
                        model="stub-model", iteration_cap=iteration_cap)


def check_lands_on_branch():
    """After the role commits onto main, the injection lands it on its own branch
    and rewinds main to the pre-run head, leaving the working tree clean."""
    import subprocess
    from prosequence.core.yaml_io import ArgumentScheme, Relation
    from prosequence.roles.run import _land_on_branch

    store, dst = fresh_store()
    head0 = store.head()
    session = Session(store, CORPUS)
    g = next(iter(session.bound_version.claims)).id
    c = session.add_claim("A claim added by the injection.", "branch-demo")
    session.add_inference([g], [], c, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    sha = session.commit("injection demo")  # lands on main via the store
    on_main = store.head() == sha

    branch = _land_on_branch(store, head0, sha, CORPUS)
    branch_target = str(store.repo.references[f"refs/heads/{branch}"].target)
    main_rewound = store.head() == head0
    clean = subprocess.run(["git", "-C", dst, "status", "--short"],
                           capture_output=True, text=True).stdout.strip() == ""
    ok = on_main and branch_target == sha and main_rewound and clean
    return ok, (f"committed_on_main={on_main} branch={branch} "
                f"branch_has_commit={branch_target == sha} "
                f"main_rewound={main_rewound} tree_clean={clean}")


def check_capability_declared():
    """Ingestion declares exactly its three additive ops as op TYPES (not
    method-name strings), and a non-empty role_prompt.

    All three only ever append — claims, inferences, thesis designations.
    `ReviseClaim` stays out, which is the grant's actual content: ingestion may
    extend the corpus in any direction, including upward past a standing thesis,
    and may not rewrite what is already there."""
    ok = (IngestionRole.capability == (AddClaim, AddInference, DesignateThesis)
          and ReviseClaim not in IngestionRole.capability
          and isinstance(IngestionRole.role_prompt, str)
          and IngestionRole.role_prompt.strip() != "")
    return ok, (f"capability={[c.__name__ for c in IngestionRole.capability]} "
                f"role_prompt_len={len(IngestionRole.role_prompt)}")


def check_system_prompt_composed():
    """The system prompt is OPERATIONS then the role's own half, composed by the
    base class. Asserted structurally, not on wording, so replacing either half
    does not break the test — what must hold is that BOTH reach the model and
    that a role declaring no prompt fails loudly rather than silently shipping
    the shared half alone."""
    from prosequence.roles.prompts import INGESTION, OPERATIONS

    store, dst = fresh_store()
    session = Session(store, CORPUS)
    tmp = tempfile.mkdtemp(prefix="role-prompt-")
    guard = GuardedClient(StubClient([]), _cfg(tmp), CORPUS,
                          token_log=os.path.join(tmp, "tok.jsonl"))
    role = IngestionRole(guard=guard, session=session,
                         model="stub-model", iteration_cap=15)
    rendered = role.system_prompt()
    both = OPERATIONS in rendered and INGESTION in rendered
    ordered = rendered.index(OPERATIONS) < rendered.index(INGESTION)

    # A role with no role_prompt must raise, not ship OPERATIONS by itself.
    class _Bare(IngestionRole):
        role_prompt = ""
    raised = False
    try:
        _Bare(guard=guard, session=session, model="stub-model",
              iteration_cap=15).system_prompt()
    except NotImplementedError:
        raised = True

    ok = both and ordered and raised
    return ok, (f"both_halves={both} operations_first={ordered} "
                f"empty_role_prompt_raises={raised} chars={len(rendered)}")


def check_capability_refuses_whole_plan():
    """A role holding only AddClaim cannot execute a plan containing an
    AddInference — and because the check runs over the whole plan first, the
    held AddClaim ahead of it is NOT written either. The old proxy refused at
    the offending call, after earlier ops had already landed."""
    from prosequence.core.yaml_io import ArgumentScheme, Relation

    store, dst = fresh_store()
    session = Session(store, CORPUS)
    target = next(c.id for c in session.bound_version.claims if not c.terminal)
    plan = (
        AddClaim(key="c1", tag="cap-test", text="A held op."),
        AddInference(grounds=(New("c1"),), warrants=(), target=Existing(ClaimId(target)),
                     relation=Relation.CONCLUDES, scheme=ArgumentScheme.DEDUCTIVE),
    )
    refused = False
    try:
        execute(session, plan, (AddClaim,))
    except CapabilityError:
        refused = True
    # Atomic: the AddClaim that WAS held did not run.
    nothing_written = len(session.diff().ops) == 0
    # The full capability accepts the same plan.
    check_capability(plan, (AddClaim, AddInference))
    ok = refused and nothing_written
    return ok, (f"disallowed_refused={refused} "
                f"nothing_written={nothing_written}")


def check_capability_rejects_non_op():
    """Declaring something that is not an Op type is a construction error,
    caught when the role is built rather than silently matching nothing."""
    from prosequence.roles.capability import validate_capability

    rejected = False
    try:
        validate_capability(("add_claim",))  # type: ignore[arg-type]
    except ValueError:
        rejected = True
    return rejected, f"non_op_capability_rejected={rejected}"


def check_plan_rejects_bad_refs():
    """What is fatal before any write, and what is only recorded.

    Fatal: an Existing ref naming nothing in the corpus (previously it fell
    through as a uuid and failed far downstream at commit), and a New ref
    nothing binds. Both make the plan unexecutable.

    NOT fatal: a created claim nothing references. Orphans are legal in the
    model — no invariant forbids them, GAP-6 warns on them, and repair creates
    them deliberately when it drops an inference — so `check_plan` returns a
    note and the run continues. This holds even when EVERY new claim is an
    orphan, which is a real defect in the finding and still not worth
    discarding the claims over."""
    from prosequence.core.yaml_io import ArgumentScheme, Relation

    def _inf(**kw):
        base = dict(grounds=(), warrants=(), target=Existing(ClaimId("real")),
                    relation=Relation.CONCLUDES, scheme=ArgumentScheme.DEDUCTIVE)
        return AddInference(**{**base, **kw})

    known = frozenset({"real"})
    results = {}
    for label, plan in (
        ("unknown_existing", (_inf(grounds=(Existing(ClaimId("ghost")),)),)),
        ("unbound_new", (_inf(grounds=(New("nope"),)),)),
    ):
        try:
            check_plan(plan, known)
            results[label] = False
        except PlanError:
            results[label] = True

    # SOME attached, one not: reported, not raised — and the note names the key
    # so the commit message can carry it. Repair relies on this staying legal,
    # since dropping an inference is how it creates orphans on purpose.
    partial = (AddClaim(key="c1", tag="t", text="x"),
               AddClaim(key="c2", tag="t2", text="y"),
               _inf(grounds=(New("c1"),)))
    try:
        notes = check_plan(partial, known)
        results["partial_orphan_noted"] = any("c2" in n for n in notes)
    except PlanError:
        results["partial_orphan_noted"] = False

    # Every new claim orphaned: fatal. A finding with no inference in it has
    # extracted no argument, and most of what it produces is unrecoverable —
    # grounds-claims are attributive, and an attributive claim with nothing to
    # ground is an orphan quote.
    try:
        check_plan((AddClaim(key="c1", tag="t", text="x"),
                    AddClaim(key="c2", tag="t2", text="y")), known)
        results["all_orphaned_raises"] = False
    except PlanError:
        results["all_orphaned_raises"] = True

    # A well-formed plan passes with nothing to report.
    good = (AddClaim(key="c1", tag="t", text="x"),
            _inf(grounds=(New("c1"),)))
    try:
        results["well_formed_passes"] = check_plan(good, known) == []
    except PlanError:
        results["well_formed_passes"] = False
    ok = all(results.values())
    return ok, " ".join(f"{k}={v}" for k, v in results.items())


def check_finding_split_across_both_fields():
    """A finding the model serialized into BOTH fields as separate JSON strings
    keeps all of it. Observed three times on large findings: `claims` arrives as
    a string wrapping `{"claims": [...], "inferences": []}` while `inferences`
    arrives as its own string wrapping the real inferences. Superseding on the
    first decoded wrapper took the nested EMPTY list and silently dropped 40, 19
    and 18 inferences across three runs — each surfacing as check_plan reporting
    that no claim was attached, which read as a model failure and was ours."""
    from prosequence.roles.apply import _normalize_finding

    claim = {"key": "c1", "tag": "T", "text": "x", "terminal": False}
    inf = {"grounds": ["c1"], "target": "u", "relation": "concludes",
           "scheme": "Deductive"}
    results = {}

    split = {"claims": json.dumps({"claims": [claim], "inferences": []}),
             "inferences": json.dumps({"inferences": [inf]})}
    got = _normalize_finding(split)
    results["split_keeps_both"] = (len(got["claims"]) == 1
                                   and len(got["inferences"]) == 1)

    # The shapes that already worked must keep working.
    plain = {"claims": [claim], "inferences": [inf]}
    got = _normalize_finding(plain)
    results["plain_unchanged"] = (got["claims"] == [claim]
                                  and got["inferences"] == [inf])

    whole = {"claims": json.dumps({"claims": [claim], "inferences": [inf]})}
    got = _normalize_finding(whole)
    results["whole_nested_recovered"] = (len(got["claims"]) == 1
                                         and len(got["inferences"]) == 1)

    arrays = {"claims": json.dumps([claim]), "inferences": json.dumps([inf])}
    got = _normalize_finding(arrays)
    results["stringified_arrays"] = (len(got["claims"]) == 1
                                     and len(got["inferences"]) == 1)

    # A genuinely empty inference list stays empty rather than being invented.
    empty = {"claims": [claim], "inferences": []}
    results["empty_stays_empty"] = _normalize_finding(empty)["inferences"] == []

    ok = all(results.values())
    return ok, " ".join(f"{k}={v}" for k, v in results.items())


def check_iteration_cap_forces_apply():
    """With the cap set to 1, a tool-calling role is forced to apply after one
    turn. Exercises the shared harness cap via a minimal looping role, since
    ingestion itself is single-shot and never loops."""
    tmp = tempfile.mkdtemp(prefix="role-cap-")
    store, dst = fresh_store()
    session = Session(store, CORPUS)
    # The model would loop forever on tools; the cap must cut it at 1.
    script = [
        _Resp([_block(type="tool_use", name="ping", input={}, id="t1")],
              stop="tool_use"),
    ]
    stub = StubClient(script)
    guard = GuardedClient(stub, _cfg(tmp, iteration_cap=1), CORPUS,
                          token_log=os.path.join(tmp, "tok.jsonl"))
    role = _looping_role(guard, session, iteration_cap=1)
    # The last message has tool_calls, so apply parses no finding -> the parse
    # raises. We only assert the loop stopped at the cap (one call).
    raised = None
    try:
        report = role.run("http://x", "A document.")
        iters = report["iterations"]
    except Exception as e:
        raised = type(e).__name__
        iters = stub.calls
    ok = stub.calls == 1 and iters == 1
    return ok, f"calls={stub.calls} iterations={iters} apply_outcome={raised or 'ops'}"


def check_repair_drops_only_violators():
    """A finding that violates I2, I5 and I6 commits anyway, minus exactly the
    three inferences at fault — and every claim survives.

    Built against the real corpus rather than a hand-made graph so the
    invariants fire the way they do in production: I5 needs an attributive
    claim to conclude, I2 a terminal one, and I6 a genuine two-step cycle.
    """
    store, dst = fresh_store()
    session = Session(store, CORPUS)
    bound = session.bound_version

    attributive = next(c.id for c in bound.claims if c.attribution is not None)
    terminal = next(c.id for c in bound.claims if c.terminal)
    plain = next(c.id for c in bound.claims
                 if not c.terminal and c.attribution is None)

    def claim(key, tag, attributive=True):
        # Attributive iff it is only ever used as grounds. The two cycle claims
        # must be concludable, and I5 forbids concluding an attributive claim —
        # make them attributive and I5 fires on both cycle edges before I6 can
        # ever form, which is not the invariant this check is aiming at.
        c = {"key": key, "tag": tag, "text": f"Text for {key}.",
             "terminal": False}
        if attributive:
            c["attribution"] = {"source": {"type": "Citation",
                                           "reference": "http://x"},
                                "quote": None}
        return c

    def inf(grounds, target, descr):
        return {"grounds": grounds, "warrants": [], "target": target,
                "relation": "concludes", "scheme": "Unknown",
                "schemeDescriptor": descr}

    finding = {
        "claims": [claim("ok", "Repair ok claim"),
                   claim("cyc_a", "Repair cycle a", attributive=False),
                   claim("cyc_b", "Repair cycle b", attributive=False)],
        "inferences": [
            inf(["ok"], plain, "valid, must survive"),          # legal
            inf(["ok"], attributive, "I5 violation"),           # concludes attributive
            inf(["ok"], terminal, "I2 violation"),              # concludes terminal
            inf(["cyc_a"], "cyc_b", "I6 half one"),             # cyc_a -> cyc_b
            inf(["cyc_b"], "cyc_a", "I6 half two"),             # cyc_b -> cyc_a
        ],
    }

    role = IngestionRole(
        guard=GuardedClient(StubClient([]), _cfg(dst), CORPUS,
                            token_log=os.path.join(dst, "tok.jsonl")),
        session=session, model="stub-model", iteration_cap=5)

    plan = role.build_plan(finding)          # runs ops -> check_plan -> repair
    notes = role._repair_notes

    kept_infs = sum(1 for op in plan if isinstance(op, AddInference))
    kept_claims = sum(1 for op in plan if isinstance(op, AddClaim))
    # "op[N] ... dropped: I6 — cycle in concludes graph: a -> b -> a" — split on
    # the marker, not on ": ", which also appears inside the cycle message.
    invs = sorted(n.split("dropped: ")[1].split(" — ")[0] for n in notes)

    execute(session, plan, role.capability)
    committed = True
    try:
        session.commit("repair test")
    except ValidationFailed:
        committed = False

    ok = (kept_claims == 3 and kept_infs == 2 and len(notes) == 3
          and invs == ["I2", "I5", "I6"] and committed)
    return ok, (f"claims_kept={kept_claims}/3 inferences_kept={kept_infs}/5 "
                f"dropped={invs} commits={committed}")


CHECKS = [
    ("ingestion role runs end to end (corpus in prompt -> finding -> apply -> commit)", check_end_to_end),
    ("repair drops only the violating inferences, keeps every claim", check_repair_drops_only_violators),
    ("injection lands commit on its own branch, rewinds main", check_lands_on_branch),
    ("upward thesis: new consequent designated and committed", check_upward_thesis_commits),
    ("designating a claim does not count as attaching it", check_designation_is_not_attachment),
    ("capability + role_prompt declared (op types)", check_capability_declared),
    ("system prompt composes operations + role halves", check_system_prompt_composed),
    ("capability refuses whole plan, writes nothing", check_capability_refuses_whole_plan),
    ("capability rejects non-Op entries", check_capability_rejects_non_op),
    ("plan rejects unresolvable refs and orphan bindings", check_plan_rejects_bad_refs),
    ("finding split across both fields keeps all of it", check_finding_split_across_both_fields),
    ("iteration cap forces apply", check_iteration_cap_forces_apply),
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

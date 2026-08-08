#!/usr/bin/env python3
"""Role checks — the ingestion role end to end, and capability enforcement.

No API, no network: a scripted Anthropic-shaped stub drives the graph against an
isolated temp corpus repo (`fresh_store`). Each check is a function; `main` runs
them and reports PASS/FAIL per line. These exercise the promoted role's full
round trip (traverse -> finding -> apply -> commit) and prove capability is
enforced at apply, not by the prompt.
"""
from __future__ import annotations

import os
import sys
import tempfile
import types

os.environ.setdefault("PROSEQUENCE_TRACE", "0")  # no exporter during tests

from prosequence.tests.test_1d import fresh_store, CORPUS
from prosequence.core.session import Session
from prosequence.core.guarded_client import GuardConfig, GuardedClient
from prosequence.roles.ingestion import IngestionRole
from prosequence.roles.capability import CapabilityGuardedSession, CapabilityError


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


class StubClient:
    """Fake Anthropic client returning scripted responses (content + usage)."""

    def __init__(self, script):
        self._script = list(script)
        self.calls = 0
        self.messages = self  # so `client.messages.create(...)` resolves here

    def create(self, **kwargs):
        r = self._script[self.calls]
        self.calls += 1
        return r


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
    ops_ok = (len(report["ops"]) == 2
              and report["ops"][0].startswith("add_claim")
              and "concludes" in report["ops"][1])
    ok = (report["sha"] != head0 and report["iterations"] == 1
          and stub.calls == 1 and ops_ok and report["tokens"] == 140)
    return ok, (f"sha_advanced={report['sha'] != head0} iters={report['iterations']} "
                f"calls={stub.calls} ops={len(report['ops'])} tokens={report['tokens']}")


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
    """Ingestion declares exactly add_claim + add_inference; objective is prose."""
    ok = (IngestionRole.capability == ("add_claim", "add_inference")
          and isinstance(IngestionRole.objective, str)
          and IngestionRole.objective.strip().startswith("You are ingesting"))
    return ok, f"capability={IngestionRole.capability} objective_len={len(IngestionRole.objective)}"


def check_capability_enforced_at_apply():
    """A role holding only add_claim cannot add_inference: the guarded session
    raises CapabilityError when apply invokes the disallowed op — no prompt
    instruction involved."""
    store, dst = fresh_store()
    session = Session(store, CORPUS)
    guarded = CapabilityGuardedSession(session, ("add_claim",))
    # add_claim is held: works and mints an id.
    cid = guarded.add_claim("held op works", "cap-test")
    held_ok = isinstance(cid, str)
    # add_inference is not held: raises at the call site.
    refused = False
    try:
        guarded.add_inference([cid], [], cid, None)
    except CapabilityError:
        refused = True
    # reads are never gated.
    read_ok = guarded.get(cid) is not None
    ok = held_ok and refused and read_ok
    return ok, f"held_op={held_ok} disallowed_refused={refused} read_passes={read_ok}"


def check_capability_rejects_nonwrite():
    """Declaring a non-write op as a capability is a construction error."""
    store, dst = fresh_store()
    session = Session(store, CORPUS)
    rejected = False
    try:
        CapabilityGuardedSession(session, ("neighborhood",))
    except ValueError:
        rejected = True
    return rejected, f"non_write_capability_rejected={rejected}"


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


CHECKS = [
    ("ingestion role runs end to end (corpus in prompt -> finding -> apply -> commit)", check_end_to_end),
    ("injection lands commit on its own branch, rewinds main", check_lands_on_branch),
    ("capability + objective declared", check_capability_declared),
    ("capability enforced at apply (not by prompt)", check_capability_enforced_at_apply),
    ("capability rejects non-write ops", check_capability_rejects_nonwrite),
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

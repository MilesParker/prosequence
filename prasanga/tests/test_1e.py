#!/usr/bin/env python3
"""Directive 1e checks — stop controls.

Exercises the guarded client with a stub (no API, no network, no key), against
real temp corpus repos for the "repo untouched on refusal" checks. Each check is
a function; `main` runs them and reports PASS/FAIL per line.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

from prasanga.core.guarded_client import (
    GuardedClient,
    GuardConfig,
    Refused,
    KillFilePresent,
    RunCapExceeded,
    CumulativeCapExceeded,
    read_log,
    cumulative_tokens,
)
from prasanga.tests.test_1d import fresh_store, CORPUS
from prasanga.core.session import Session
from prasanga.core.yaml_io import ArgumentScheme, Relation

# prasanga/ package dir (holds guard_config.toml) and the repo root.
PKG_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(PKG_DIR)


# --------------------------------------------------------------------------
# Stub client — scripted usage, mirrors the anthropic surface the guard uses
# (`client.messages.create(...) -> resp.usage.{input,output}_tokens`).
# --------------------------------------------------------------------------

class _Usage:
    def __init__(self, i, o):
        self.input_tokens = i
        self.output_tokens = o


class _Resp:
    def __init__(self, i, o):
        self.usage = _Usage(i, o)


class StubClient:
    """A fake Anthropic client returning scripted (input, output) token usage."""

    def __init__(self, script):
        self._script = list(script)
        self.calls = 0
        self.messages = self  # so `client.messages.create(...)` resolves here

    def create(self, **kwargs):
        i, o = self._script[self.calls]
        self.calls += 1
        return _Resp(i, o)


def _cfg(tmp, per_run, cumulative, window=86400, kill=None, model="stub-model"):
    return GuardConfig(
        per_run_token_cap=per_run,
        cumulative_token_cap=cumulative,
        cumulative_window_seconds=window,
        kill_file=kill if kill is not None else os.path.join(tmp, "STOP"),
        model=model,
    )


def _log_lines(path):
    if not os.path.exists(path):
        return 0
    with open(path) as fh:
        return sum(1 for ln in fh if ln.strip())


def _repo_clean_and_unmoved(dst, head_before):
    unmoved = subprocess.run(
        ["git", "-C", dst, "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip() == head_before
    clean = subprocess.run(
        ["git", "-C", dst, "status", "--short"], capture_output=True, text=True
    ).stdout.strip() == ""
    return unmoved and clean


MSG = [{"role": "user", "content": "hello"}]


# --------------------------------------------------------------------------
# Checks. Each returns (ok, detail).
# --------------------------------------------------------------------------

def check_per_run_zero():
    """Per-run cap 0: refuse on the first call — no API call, no commit, no log."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    log = os.path.join(tmp, "tok.jsonl")
    store, dst = fresh_store()
    head = store.head()
    _sess = Session(store, CORPUS)  # a run opens a session, then makes calls
    stub = StubClient([(10, 10)])
    gc = GuardedClient(stub, _cfg(tmp, per_run=0, cumulative=10**9), CORPUS, token_log=log)
    refused = False
    try:
        gc.create(max_tokens=100, messages=MSG)
    except RunCapExceeded:
        refused = True
    ok = refused and stub.calls == 0 and _log_lines(log) == 0 and _repo_clean_and_unmoved(dst, head)
    return ok, f"refused={refused} api_calls={stub.calls} log_lines={_log_lines(log)} repo_untouched={_repo_clean_and_unmoved(dst, head)}"


def check_cumulative_already_exceeded():
    """Cumulative cap already exceeded by existing log lines: refuse, same as above."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    log = os.path.join(tmp, "tok.jsonl")
    # Pre-populate the log so the in-window sum already exceeds the cap.
    with open(log, "w") as fh:
        fh.write(json.dumps({"timestamp": time.time(), "run_id": "old", "corpus": CORPUS,
                             "model": "m", "input_tokens": 600, "output_tokens": 600,
                             "committed": True}) + "\n")
    store, dst = fresh_store()
    head = store.head()
    _sess = Session(store, CORPUS)
    stub = StubClient([(10, 10)])
    gc = GuardedClient(stub, _cfg(tmp, per_run=10**9, cumulative=1000), CORPUS, token_log=log)
    refused = False
    try:
        gc.create(max_tokens=100, messages=MSG)
    except CumulativeCapExceeded:
        refused = True
    ok = refused and stub.calls == 0 and _log_lines(log) == 1 and _repo_clean_and_unmoved(dst, head)
    return ok, f"refused={refused} api_calls={stub.calls} log_unchanged={_log_lines(log)==1} repo_untouched={_repo_clean_and_unmoved(dst, head)}"


def check_kill_file_lifecycle():
    """Kill file: present at start -> refuse; created between calls -> 2nd refuses;
    deleted -> a fresh run proceeds."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    log = os.path.join(tmp, "tok.jsonl")
    kill = os.path.join(tmp, "STOP")
    cfg = _cfg(tmp, per_run=10**9, cumulative=10**9, kill=kill)

    # (a) present at start -> refuse, no call, repo untouched.
    store, dst = fresh_store()
    head = store.head()
    _sess = Session(store, CORPUS)
    open(kill, "w").close()
    stub_a = StubClient([(10, 10)])
    gc_a = GuardedClient(stub_a, cfg, CORPUS, token_log=log)
    start_refused = False
    try:
        gc_a.create(max_tokens=100, messages=MSG)
    except KillFilePresent:
        start_refused = True
    a_ok = start_refused and stub_a.calls == 0 and _repo_clean_and_unmoved(dst, head)
    os.remove(kill)

    # (b) call 1 proceeds; create kill; call 2 refuses.
    stub_b = StubClient([(10, 10), (10, 10)])
    gc_b = GuardedClient(stub_b, cfg, CORPUS, token_log=log)
    gc_b.create(max_tokens=100, messages=MSG)          # proceeds
    first_calls = stub_b.calls
    open(kill, "w").close()
    mid_refused = False
    try:
        gc_b.create(max_tokens=100, messages=MSG)       # refuses
    except KillFilePresent:
        mid_refused = True
    b_ok = first_calls == 1 and mid_refused and stub_b.calls == 1 and _log_lines(log) == 1
    os.remove(kill)

    # (c) deleted -> a fresh run proceeds.
    stub_c = StubClient([(10, 10)])
    gc_c = GuardedClient(stub_c, cfg, CORPUS, token_log=log)
    gc_c.create(max_tokens=100, messages=MSG)
    c_ok = stub_c.calls == 1 and _log_lines(log) == 2

    ok = a_ok and b_ok and c_ok
    return ok, f"present@start={a_ok} created-between-calls={b_ok} deleted-proceeds={c_ok}"


def check_one_line_per_call():
    """A normal run writes exactly one log line per API call, counts matching."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    log = os.path.join(tmp, "tok.jsonl")
    script = [(120, 30), (200, 55), (75, 12)]
    stub = StubClient(script)
    gc = GuardedClient(stub, _cfg(tmp, per_run=10**9, cumulative=10**9), CORPUS, token_log=log)
    for _ in script:
        gc.create(max_tokens=1000, messages=MSG)
    recs = read_log(log)
    counts_match = [(r["input_tokens"], r["output_tokens"]) for r in recs] == script
    ok = len(recs) == len(script) == stub.calls and counts_match
    return ok, f"api_calls={stub.calls} log_lines={len(recs)} counts_match={counts_match}"


def check_cumulative_matches_handsum():
    """Cumulative total computed from the log matches a hand-summed total."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    log = os.path.join(tmp, "tok.jsonl")
    script = [(120, 30), (200, 55), (75, 12)]
    stub = StubClient(script)
    gc = GuardedClient(stub, _cfg(tmp, per_run=10**9, cumulative=10**9), CORPUS, token_log=log)
    for _ in script:
        gc.create(max_tokens=1000, messages=MSG)
    from_log = cumulative_tokens(log)
    hand = sum(i + o for i, o in script)
    ok = from_log == hand
    return ok, f"from_log={from_log} hand_summed={hand} match={ok}"


def check_stub_substitution_no_core_change():
    """Substituting a stub for the real client requires no change to session,
    ops, or store — they never touch the client. Full run: guarded calls with a
    stub, then a real session.commit."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    log = os.path.join(tmp, "tok.jsonl")
    store, dst = fresh_store()
    head = store.head()
    sess = Session(store, CORPUS)
    stub = StubClient([(100, 40), (60, 20)])
    gc = GuardedClient(stub, _cfg(tmp, per_run=10**9, cumulative=10**9), CORPUS, token_log=log)
    # "Model calls" decide what to add (content here is scripted, not reasoned).
    gc.create(max_tokens=500, messages=MSG)
    g = next(iter(sess.bound_version.claims)).id
    c = sess.add_claim("A claim decided during the run.", "1e-demo")
    sess.add_inference([g], [], c, Relation.CONCLUDES, ArgumentScheme.DEDUCTIVE)
    gc.create(max_tokens=500, messages=MSG, committed=True)
    sha = sess.commit("1e: guarded-run demo commit")
    moved = subprocess.run(["git", "-C", dst, "rev-parse", "HEAD"],
                           capture_output=True, text=True).stdout.strip()
    ok = sha == moved and moved != head and _log_lines(log) == 2 and stub.calls == 2
    return ok, f"committed sha={sha[:12]} head_advanced={moved!=head} log_lines={_log_lines(log)}"


def check_config_rejects_prices_and_keys():
    """GuardConfig.load rejects a config carrying a price or an api key."""
    tmp = tempfile.mkdtemp(prefix="1e-")
    bad = os.path.join(tmp, "bad.toml")
    with open(bad, "w") as fh:
        fh.write('per_run_token_cap=1\ncumulative_token_cap=1\n'
                 'cumulative_window_seconds=1\nkill_file="STOP"\nmodel="m"\n'
                 'api_key="sk-should-not-be-here"\n')
    rejected = False
    try:
        GuardConfig.load(bad)
    except ValueError:
        rejected = True
    # And the committed real config loads fine (now lives in the package dir).
    real = GuardConfig.load(os.path.join(PKG_DIR, "guard_config.toml"))
    ok = rejected and real.per_run_token_cap > 0 and bool(real.model)
    return ok, f"rejects_api_key={rejected}; real_config_loads (model={real.model!r})"


def check_log_gitignored_and_outside_corpus():
    """The token log is gitignored and absent from the corpus repo."""
    ignored = subprocess.run(["git", "-C", REPO_ROOT, "check-ignore", "logs/token_log.jsonl"],
                             capture_output=True, text=True).returncode == 0
    # Not present in the corpus repo tree at head.
    in_corpus = subprocess.run(
        ["git", "-C", os.path.join(REPO_ROOT, "discourse-spaces"), "ls-files", "logs/token_log.jsonl"],
        capture_output=True, text=True).stdout.strip()
    ok = ignored and in_corpus == ""
    return ok, f"gitignored={ignored} in_corpus_repo={bool(in_corpus)}"


CHECKS = [
    ("per-run cap 0 refuses first call (no call/commit/log)", check_per_run_zero),
    ("cumulative cap already exceeded refuses", check_cumulative_already_exceeded),
    ("kill file present/created/deleted lifecycle", check_kill_file_lifecycle),
    ("one log line per API call, counts match", check_one_line_per_call),
    ("cumulative from log == hand-summed", check_cumulative_matches_handsum),
    ("stub substitution needs no core change (full run+commit)", check_stub_substitution_no_core_change),
    ("config rejects prices/keys; real config loads", check_config_rejects_prices_and_keys),
    ("token log gitignored + outside corpus repo", check_log_gitignored_and_outside_corpus),
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

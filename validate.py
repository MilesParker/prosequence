#!/usr/bin/env python3
"""Structural validator for v2 discourse-space corpora.

Enforces invariants I1–I8 from src/types.ts against the YAML corpora. Node
kind is resolved by membership in the `claims` / `inferences` arrays — never
inferred from an id prefix. Detects only; enthymemification is authoring work,
so there is no auto-fix.

Every invariant violation (I1–I8) is an error: exit status is non-zero if any
error is found. GAP-6 gaps are reported as warnings — a claim that is
non-terminal, non-attributive, not a root, and concluded by nothing is either
an authoring gap or a claim that should be declared a root. A warning is
reported but does not affect exit status.

Usage: python validate.py <corpus.yaml> [<corpus.yaml> ...]
"""
import sys, glob
import yaml


def roots_of(d):
    if 'roots' in d:
        return list(d['roots'])
    for k in ('discourseSpace', 'discourse_space'):
        if k in d:
            return list(d[k].get('roots', []))
    return []


def validate(path):
    d = yaml.safe_load(open(path))
    claims = {c['id']: c for c in d.get('claims', [])}
    infs   = {i['id']: i for i in d.get('inferences', [])}
    roots  = roots_of(d)

    errs  = []   # errors -> non-zero exit
    warns = []   # warnings (GAP-6 gaps) -> reported only

    def fail(inv, iid, target, msg):
        # file, invariant, inference id, target id — in that order.
        errs.append(f"{path}: {inv} {iid} {target}  {msg}")

    for iid, i in infs.items():
        concludes = i.get('concludes')
        contests  = i.get('contests')
        grounds   = i.get('grounds') or []
        warrants  = i.get('warrants') or []

        # I1 — exactly one of {concludes, contests}. (Type-enforced in TS.)
        n_out = (1 if concludes else 0) + (1 if contests else 0)
        if n_out != 1:
            fail("I1", iid, "-", f"has {n_out} outputs (need exactly one of concludes/contests)")

        # I3 — every referenced id resolves within the space.
        for g in grounds:
            if g not in claims:
                fail("I3", iid, g, "grounds id does not resolve to a claim")
        for w in warrants:
            if w not in claims:
                fail("I3", iid, w, "warrant id does not resolve to a claim")
        if concludes and concludes not in claims:
            fail("I3", iid, concludes, "concludes id does not resolve to a claim")
        if contests and contests not in claims and contests not in infs:
            fail("I3", iid, contests, "contests id does not resolve to any node")

        # I2 — no inference concludes a terminal claim.
        if concludes in claims and claims[concludes].get('terminal'):
            fail("I2", iid, concludes, "concludes a terminal claim")

        # I4 — grounds is non-empty.
        if not grounds:
            fail("I4", iid, "-", "zero grounds (grounds must be non-empty)")

        # I5 — attributive claims must not be concluded; they are checkable
        #      leaves, verified against their cited source rather than derived.
        if concludes in claims and claims[concludes].get('attribution') is not None:
            fail("I5", iid, concludes, "concludes an attributive (checkable-leaf) claim")

        # I7 — terminal claims appear only in warrants: never in grounds,
        #      never as a contests target.
        for g in grounds:
            if g in claims and claims[g].get('terminal'):
                fail("I7", iid, g, "terminal claim used as grounds (terminals belong only in warrants)")
        if contests in claims and claims[contests].get('terminal'):
            fail("I7", iid, contests, "terminal claim used as a contests target")

        # I8 — a contests target resolves to a member of `claims`, never an
        #      inference. Undercuts (inference-targeting attacks) are not
        #      representable; surface the suppressed warrant as a claim instead.
        if contests and contests in infs and contests not in claims:
            fail("I8", iid, contests, "contests targets an inference (attacks may only target claims)")

    # I3 — roots resolve to claims.
    for r in roots:
        if r not in claims:
            fail("I3", "-", r, "root id does not resolve to a claim")

    # I6 — the graph of Concludes edges is acyclic. Support chains
    #      (grounds/warrants -> inference -> concludes) may not cycle; contests
    #      edges are excluded (an attack is allowed to point "up").
    adj = {}
    for iid, i in infs.items():
        adj.setdefault(iid, [])
        for c in (i.get('grounds') or []) + (i.get('warrants') or []):
            adj.setdefault(c, []).append(iid)     # claim -> inference
        concludes = i.get('concludes')
        if concludes:
            adj[iid].append(concludes)            # inference -> concluded claim
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in adj}
    reported = set()

    def dfs(n, stack):
        color[n] = GREY
        for m in adj.get(n, []):
            c = color.get(m, WHITE)
            if c == GREY and m not in reported:
                reported.add(m)
                cyc = stack[stack.index(m):] + [m] if m in stack else [m]
                fail("I6", "-", m, "cycle in concludes graph: " + " -> ".join(cyc))
            elif c == WHITE:
                dfs(m, stack + [m])
        color[n] = BLACK

    for n in list(adj):
        if color.get(n, WHITE) == WHITE:
            dfs(n, [n])

    # GAP-6 (warning) — a non-terminal, non-attributive claim that is not a
    #     root and is concluded by nothing is either an authoring gap or a
    #     claim that should be declared a root. Warned, never an error.
    concluded = {i.get('concludes') for i in infs.values() if i.get('concludes')}
    for cid, c in claims.items():
        if c.get('terminal'):
            continue
        if c.get('attribution') is not None:
            continue
        if cid in roots:
            continue
        if cid not in concluded:
            warns.append(f"{path}: GAP6 - {cid}  non-terminal, non-attributive, not a root, and concluded by nothing (GAP-6 gap, or it should be a root)")

    print(f"{path}: {len(claims)} claims, {len(infs)} inferences, {len(roots)} root(s)")
    for w in warns:
        print("   WARN", w)
    if errs:
        for e in errs:
            print("   FAIL", e)
    else:
        print("   PASS  I1 one-output  I2 no-concludes-terminal  I3 refint  "
              "I4 grounds>=1  I5 no-concludes-attributive  I6 acyclic-concludes  "
              "I7 terminals-warrants-only  I8 contests-claim-only"
              + ("  (GAP-6 warnings above)" if warns else ""))
    return not errs


def main(argv):
    paths = []
    for a in argv:
        paths.extend(sorted(glob.glob(a)) or [a])
    if not paths:
        paths = sorted(glob.glob('discourse-spaces/*.v2.yaml'))
    if not paths:
        print("usage: python validate.py <corpus.yaml> [<corpus.yaml> ...]", file=sys.stderr)
        return 2
    ok = all([validate(p) for p in paths])
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

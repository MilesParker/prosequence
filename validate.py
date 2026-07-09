import yaml, sys

def roots_of(d):
    for k in ('roots',):
        if k in d: return set(d[k])
    for k in ('discourseSpace','discourse_space'):
        if k in d: return set(d[k].get('roots',[]))
    return set()

def validate(path):
    d = yaml.safe_load(open(path))
    claims = {c['id']:c for c in d['claims']}
    infs   = {i['id']:i for i in d['inferences']}
    roots  = roots_of(d)
    errs = []

    # I1 referential integrity
    for iid,i in infs.items():
        for g in (i.get('grounds') or []):
            if g not in claims: errs.append(f"I1 {iid}: grounds '{g}' not a Claim")
        for w in (i.get('warrants') or []):
            if w not in claims: errs.append(f"I1 {iid}: warrant '{w}' not a Claim")
        if i.get('concludes') and i['concludes'] not in claims:
            errs.append(f"I1 {iid}: concludes '{i['concludes']}' not a Claim")
        if i.get('contests') and i['contests'] not in claims and i['contests'] not in infs:
            errs.append(f"I1 {iid}: contests '{i['contests']}' unknown")
    for r in roots:
        if r not in claims: errs.append(f"I1 root '{r}' not a Claim")

    # I2 exactly one output
    for iid,i in infs.items():
        n = (1 if i.get('concludes') else 0) + (1 if i.get('contests') else 0)
        if n != 1: errs.append(f"I2 {iid}: has {n} outputs (need exactly 1)")

    # I3 grounds >= 1
    for iid,i in infs.items():
        if not (i.get('grounds') or []): errs.append(f"I3 {iid}: zero grounds")

    # I4 no inference concludes a terminal
    for iid,i in infs.items():
        t = i.get('concludes')
        if t in claims and claims[t].get('terminal'): errs.append(f"I4 {iid}: concludes terminal '{t}'")

    # I5 concludes targets a Claim only (inferences may only be contested)
    for iid,i in infs.items():
        if i.get('concludes') in infs: errs.append(f"I5 {iid}: concludes an Inference")

    # I6 acyclicity over claim<->inference bipartite graph
    adj = {}
    for iid,i in infs.items():
        adj.setdefault(iid, [])
        for g in (i.get('grounds') or []) + (i.get('warrants') or []):
            adj.setdefault(g, []).append(iid)     # claim -> inference
        tgt = i.get('concludes') or i.get('contests')
        if tgt: adj[iid].append(tgt)              # inference -> target
    WHITE,GREY,BLACK = 0,1,2
    color = {n:WHITE for n in adj}
    def dfs(n, stack):
        color[n]=GREY
        for m in adj.get(n,[]):
            if color.get(m,WHITE)==GREY:
                errs.append(f"I6 cycle: {' -> '.join(stack[stack.index(m):]+[m])}" if m in stack else f"I6 cycle at {m}")
            elif color.get(m,WHITE)==WHITE:
                dfs(m, stack+[m])
        color[n]=BLACK
    for n in list(adj):
        if color[n]==WHITE: dfs(n,[n])

    # I7 NEW: terminals appear only in warrants
    for iid,i in infs.items():
        for g in (i.get('grounds') or []):
            if claims.get(g,{}).get('terminal'): errs.append(f"I7 {iid}: terminal '{g}' used as grounds")
        tgt = i.get('contests')
        if tgt in claims and claims[tgt].get('terminal'): errs.append(f"I7 {iid}: contests terminal '{tgt}'")

    print(f"{path}: {len(claims)} claims, {len(infs)} inferences, {len(roots)} root(s)")
    if errs:
        for e in errs: print("   FAIL", e)
    else:
        print("   PASS  I1 refint  I2 one-output  I3 grounds>=1  I4 no-concludes-terminal  I5 concludes-claim-only  I6 acyclic  I7 terminals-warrants-only")
    return not errs

ok = all([validate(p) for p in ['freedman_v2.yaml','gaza_v2.yaml','free-transit_v2.yaml']])
sys.exit(0 if ok else 1)
# From strings to op objects — a play-by-play

Refactor of capability enforcement and the apply step in a LangGraph-based
ingestion harness. Commit `baea735`: +584 / -198 across 9 files.

## Stage 0 — what was there

Capability was a set of method names; enforcement was a proxy intercepting
attribute access.

```python
# capability.py
WRITE_OPS = frozenset({"add_claim", "add_inference", "revise_claim"})

class CapabilityGuardedSession:
    def __init__(self, session, capability):
        self._capability = frozenset(capability)
        unknown = self._capability - WRITE_OPS
        if unknown:
            raise ValueError(f"capability names non-write ops {sorted(unknown)}")

    def __getattr__(self, name):
        attr = getattr(self._session, name)
        if name in WRITE_OPS and name not in self._capability:
            def _refused(*_a, **_k):
                raise CapabilityError(f"role does not hold capability {name!r}")
            return _refused
        return attr
```

```python
# ingestion.py
capability: tuple[str, ...] = ("add_claim", "add_inference")
```

Apply walked the model's finding and called session methods directly, minting
ids as it went.

```python
# apply.py
def apply_finding(session, finding) -> Tuple[str, ...]:
    ops, key_to_uuid = [], {}
    for c in finding["claims"]:
        cid = session.add_claim(text=c["text"], tag=c["tag"], ...)
        key_to_uuid[c["key"]] = cid
        ops.append(f'add_claim {cid} "{c["tag"]}"')

    def resolve(ref):
        return key_to_uuid.get(ref, ref)

    for inf in finding["inferences"]:
        session.add_inference(grounds=[resolve(g) for g in inf["grounds"]], ...)
    return tuple(ops)
```

**Four defects.**

1. `WRITE_OPS` is a hand-maintained mirror of `Session`'s mutating surface.
   Rename a method on either side and the grant breaks silently, surfacing as an
   `AttributeError` mid-run.
2. `__getattr__` makes the guarded session opaque to a type checker. The proxy
   enforcing the contract is the same construct that hides it.
3. Enforcement at the call site is **non-atomic**. A finding whose third write
   is disallowed has already committed the first two to the session when it
   raises.
4. `resolve()` returns `key_to_uuid.get(ref, ref)` — a ref that is not a known
   key falls through **as a uuid**. A mistyped key is indistinguishable from a
   corpus id and fails much later, as a referential-integrity violation naming
   an id that appears nowhere.

## Stage 1 — the conservative fix (rejected)

First proposal: a `Literal` type for the grant, plus a `@write_op` decorator so
`WRITE_OPS` derives from `Session` instead of mirroring it.

This fixes defect 1 only. It keeps the proxy, keeps interception, keeps
non-atomic refusal, keeps the ref conflation. It makes the *labels* on the
dispatch typed without questioning the dispatch. Rejected as too conservative.

## Stage 2 — reify the operation

An op becomes a value: a frozen dataclass carrying its parameters.

```python
@dataclass(frozen=True)
class AddClaim(Op[ClaimId]):
    key: str
    tag: str
    text: str
    terminal: bool = False
    attribution: Optional[Attribution] = None

    def binds(self) -> str:
        return self.key

    def apply(self, session, env: Env) -> ClaimId:
        return ClaimId(session.add_claim(
            text=self.text, tag=self.tag,
            attribution=self.attribution, terminal=self.terminal))
```

Once the op is a value there is no method call left to intercept — which is what
makes the rest of the refactor subtractive rather than additive.

## Stage 3 — generic in what applying yields

`-> str` was wrong: `revise_claim` mints nothing. `-> str | None` was imprecise.
The parameter also carries the id brand.

```python
ClaimId = NewType("ClaimId", str)
InferenceId = NewType("InferenceId", str)
T_co = TypeVar("T_co", covariant=True)

class Op(Generic[T_co]):
    def apply(self, session, env: Env) -> T_co: ...
    def refs(self) -> tuple[Ref[ClaimId], ...]: return ()
    def binds(self) -> Optional[str]: return None
```

`AddClaim(Op[ClaimId])`, `AddInference(Op[InferenceId])`, `ReviseClaim(Op[None])`.

Side effect: `AddInference.target: Ref[ClaimId]` makes "an inference targeting
an inference" **unrepresentable**, where it had been prose in the prompt plus a
commit-time invariant.

## Stage 4 — typed references

Ids are minted by the session at add time. Nothing has an id before the thing it
names exists, so an op carries a *reference*, and the two kinds are different
types.

```python
@dataclass(frozen=True)
class New(Generic[T]):
    key: str          # a name in this plan's local scope

@dataclass(frozen=True)
class Existing(Generic[T]):
    id: T             # the identity of a node already in the corpus

Ref = Union[New[T], Existing[T]]
Env = dict[str, ClaimId]

def resolve(ref: Ref[ClaimId], env: Env) -> ClaimId:
    if isinstance(ref, Existing):
        return ref.id
    bound = env.get(ref.key)
    if bound is None:
        raise PlanError(f"reference to {ref.key!r} but nothing in this plan bound it")
    return bound
```

This kills defect 4. A `New` with no binding and an `Existing` not in the corpus
are now distinct, named errors instead of a silent fallthrough.

## Stage 5 — capability becomes containment

```python
# capability.py — the proxy and WRITE_OPS are gone
def check_capability(plan, capability) -> None:
    held = tuple(capability)
    refused = sorted({type(op).__name__ for op in plan if type(op) not in held})
    if refused:
        raise CapabilityError(f"role does not hold {refused}")
```

```python
# ingestion.py
capability: tuple[type[Op], ...] = (AddClaim, AddInference)
```

Running over the whole plan before the first write kills defect 3: refusal is
now atomic. `validate_capability` rejects non-`Op` entries at role construction,
replacing the old `capability - WRITE_OPS` check.

## Stage 6 — split apply into build and execute

`plan_from_finding(finding, known_ids) -> tuple[Op, ...]` is pure: no session,
no writes, testable without a corpus. A wire ref is still a bare string,
resolved to a kind at this one boundary:

```python
keys = {c["key"] for c in finding["claims"]}

def ref(raw: str) -> Ref[ClaimId]:
    return New(raw) if raw in keys else Existing(ClaimId(raw))
```

Execution is a fold with a binding environment:

```python
def execute(session, plan, capability) -> tuple:
    check_capability(plan, capability)
    env: Env = {}
    for op in plan:
        minted = op.apply(session, env)
        key = op.binds()
        if key is not None:
            env[key] = minted
    return tuple(plan)
```

## Stage 7 — plan checks generalize a special case

Three structural rules, no session required:

```python
def check_plan(plan, known_ids) -> None:
    # every Existing is in the corpus
    # every New is bound by an EARLIER op   (ordering, not assumed)
    # every binding is referenced by something
```

The third rule replaces `_check_all_claims_attached`, a bespoke check added
after the model twice submitted claims with no inferences attaching them. As a
property of the op graph it stops being a special case.

## Ledger

**Deleted:** `CapabilityGuardedSession` and its `__getattr__` proxy; `WRITE_OPS`;
the `capability - WRITE_OPS` validation; `_check_all_claims_attached`; the
inline op-line formatting in apply (the session already renders its own op log
from records); `report["ops"]`, an unread third rendering of the same thing.

**Fixed:** silent ref fallthrough; non-atomic capability refusal; name-mirror
drift; untyped session parameter at the apply boundary.

**Added:** `plan.py` (271 lines) — ops, refs, plan checks, execution.

**Unchanged:** the wire schema the model sees. A ref is still a bare string;
disambiguation happens at the harness boundary, not on the wire.

## The heuristic that was missing

The original ranking priced reification as "most invasive" by counting what it
adds. The right question is what it lets you **delete** — and a refactor that
removes a mechanism is usually right, where one that adds a layer is usually
speculative.

The mismatch was visible on day one: this domain already treats claims and
inferences as values with identity minted at creation. Representing *operations*
as names was a structural mismatch with the domain, and the `resolve()` bug was
derivable from it rather than bad luck. Waiting for the bug as evidence meant
waiting for something the mismatch already implied.

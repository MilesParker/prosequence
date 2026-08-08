#!/usr/bin/env python3
"""Read-only tool surface over the writer session.

Every tool is a thin wrapper over an *existing* session query (session.py) — no
query is reimplemented here, and no new session method was added. One entry has
no backing query and is handled honestly rather than invented:

  * get_all_tags — the entry point. The session exposes `find_by_tag(tag)` but
    nothing that ENUMERATES tags. Built here over the public
    `session.bound_version.claims`; the gap is that this reaches past the
    session's query API into the model. Reported.

There is deliberately no `stance` tool: no stance query exists anywhere in the
repo (session, ops, yaml_io, validate), and it is left unimplemented rather than
bound to a marker or a fabricated algorithm.

Tools return JSON strings: ToolNode wraps a tool's return value into a
ToolMessage whose content the model reads, so the return has to be text.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from langchain_core.tools import tool

from ..core.yaml_io import Claim, Inference


# --------------------------------------------------------------------------
# Node -> JSON. The model reads these, so keep them compact and complete.
# --------------------------------------------------------------------------

def _claim_dict(c: Claim) -> dict:
    d = {
        "kind": "claim",
        "id": c.id,
        "tag": c.tag,
        "text": c.text,
        "terminal": c.terminal,
        "submissionStatus": c.submissionStatus,
    }
    if c.attribution is not None:
        d["attribution"] = {
            "source": {
                "type": c.attribution.source.type,
                "reference": c.attribution.source.reference,
            },
            "quote": c.attribution.quote,
        }
    return d


def _inference_dict(i: Inference) -> dict:
    return {
        "kind": "inference",
        "id": i.id,
        "grounds": list(i.grounds),
        "warrants": list(i.warrants),
        "target": i.target,
        "relation": i.relation.value,
    }


def _node_dict(node: Any) -> dict:
    if isinstance(node, Claim):
        return _claim_dict(node)
    if isinstance(node, Inference):
        return _inference_dict(node)
    return {"error": "unknown node kind"}


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def build_read_tools(session) -> tuple[list, list[dict]]:
    """Return (langchain tools for ToolNode, Anthropic tool schemas).

    The two lists describe the same surface: LangChain tool objects for
    dispatch, hand-written Anthropic `input_schema` dicts for the API call
    (langchain_core 1.5 has no convert_to_anthropic_tool helper).
    """

    @tool
    def get_all_tags() -> str:
        """List every claim in the corpus as (id, tag). The entry point: start here to see what already exists before attaching anything."""
        # GAP: no session enumerate-tags query; reach the public bound version.
        pairs = [{"id": c.id, "tag": c.tag} for c in session.bound_version.claims]
        return _dump(pairs)

    @tool
    def get(id: str) -> str:
        """Fetch one node (claim or inference) by its uuid."""
        node = session.get(id)
        if node is None:
            return _dump({"error": f"no node {id}"})
        return _dump(_node_dict(node))

    @tool
    def neighborhood(id: str, hops: int) -> str:
        """All nodes within `hops` undirected edges of `id`, keyed by uuid."""
        nodes = session.neighborhood(id, hops)
        return _dump({nid: _node_dict(n) for nid, n in nodes.items()})

    @tool
    def concludes(id: str) -> str:
        """Inferences whose target is `id` with relation 'concludes'."""
        return _dump([_inference_dict(i) for i in session.concludes(id)])

    @tool
    def contesting(id: str) -> str:
        """Inferences whose target is `id` with relation 'contests'."""
        return _dump([_inference_dict(i) for i in session.contesting(id)])

    @tool
    def grounds_citing(id: str) -> str:
        """Inferences that cite `id` in their grounds."""
        return _dump([_inference_dict(i) for i in session.grounds_citing(id)])

    @tool
    def warrants_citing(id: str) -> str:
        """Inferences that cite `id` in their warrants."""
        return _dump([_inference_dict(i) for i in session.warrants_citing(id)])

    lc_tools = [
        get_all_tags, get, neighborhood, concludes,
        contesting, grounds_citing, warrants_citing,
    ]

    def _id_schema(*names: str) -> dict:
        props = {n: {"type": "string"} for n in names}
        return {"type": "object", "properties": props, "required": list(names)}

    anthropic_schemas = [
        {"name": "get_all_tags",
         "description": "List every claim in the corpus as (id, tag). The entry point: call this first.",
         "input_schema": {"type": "object", "properties": {}, "required": []}},
        {"name": "get", "description": "Fetch one node (claim or inference) by uuid.",
         "input_schema": _id_schema("id")},
        {"name": "neighborhood", "description": "Nodes within `hops` undirected edges of `id`.",
         "input_schema": {"type": "object",
                          "properties": {"id": {"type": "string"}, "hops": {"type": "integer"}},
                          "required": ["id", "hops"]}},
        {"name": "concludes", "description": "Inferences that conclude `id`.",
         "input_schema": _id_schema("id")},
        {"name": "contesting", "description": "Inferences that contest `id`.",
         "input_schema": _id_schema("id")},
        {"name": "grounds_citing", "description": "Inferences citing `id` in grounds.",
         "input_schema": _id_schema("id")},
        {"name": "warrants_citing", "description": "Inferences citing `id` in warrants.",
         "input_schema": _id_schema("id")},
    ]

    return lc_tools, anthropic_schemas

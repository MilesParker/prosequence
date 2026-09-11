#!/usr/bin/env python3
"""Prompt text, one module per prompt. Prose only — no logic lives here.

Every role's system prompt is two pieces, composed by `Role.system_prompt`:

    OPERATIONS           shared by every agent — the model and the corpus
                         discipline (operations.py)
    <agent>.role_prompt  that agent's job, its input, and its finding contract
                         (one module per agent)

The split is the editing boundary. A rule that would hold for contest and
revise as much as for ingestion goes in `operations.py` and is written once;
anything that names a specific agent's tool, capability, or input goes in that
agent's module. If you find yourself writing "if you are ingesting..." in
operations.py, the sentence is in the wrong file.

OPERATIONS is shared by every agent, not only by the ones that write. The
collection agent never commits and still needs it: it is judging whether a
corpus is well covered, which is a judgment about claims, inferences and
warrants.

Adding an agent: add `<agent>.py` here with a single module-level constant, and
set `role_prompt` on the Agent subclass. Nothing else needs to change — the base
class does the composition.
"""
from __future__ import annotations

from .collection import COLLECTION
from .ingestion import INGESTION
from .operations import OPERATIONS

__all__ = ["COLLECTION", "INGESTION", "OPERATIONS"]

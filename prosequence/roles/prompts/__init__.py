#!/usr/bin/env python3
"""Prompt text, one module per prompt. Prose only — no logic lives here.

Every role's system prompt is two pieces, composed by `Role.system_prompt`:

    OPERATIONS          shared by every role — the model and the corpus
                        discipline (operations.py)
    <role>.role_prompt  that role's job, its input, and its finding contract
                        (one module per role)

The split is the editing boundary. A rule that would hold for contest and
revise as much as for ingestion goes in `operations.py` and is written once;
anything that names a specific role's tool, capability, or input goes in that
role's module. If you find yourself writing "if you are ingesting..." in
operations.py, the sentence is in the wrong file.

Adding a role: add `<role>.py` here with a single module-level constant, and
set `role_prompt` on the Role subclass. Nothing else needs to change — the base
class does the composition.
"""
from __future__ import annotations

from .ingestion import INGESTION
from .operations import OPERATIONS

__all__ = ["INGESTION", "OPERATIONS"]

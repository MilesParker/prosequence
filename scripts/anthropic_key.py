"""Anthropic API key access.

The key comes from the environment only — never hard-coded here. Set it in your
shell before running any script that imports this:

    export ANTHROPIC_API_KEY="sk-ant-..."

`anthropic.Anthropic()` reads ANTHROPIC_API_KEY on its own, so passing KEY is
optional; it is exposed here only for the existing `Anthropic(api_key=KEY)`
call sites.
"""
import os

KEY = os.environ.get("ANTHROPIC_API_KEY")

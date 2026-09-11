#!/usr/bin/env python3
"""LangChain <-> Anthropic message translation.

DRAFT, but note this whole module is friction, not design: it exists only
because the guard (guarded_client.GuardedClient) wraps the *raw* Anthropic SDK
(`client.messages.stream`), while LangGraph's ToolNode and the add_messages
reducer speak LangChain `BaseMessage` objects. There is no LangChain chat-model
adapter in the loop, so the `call` node has to translate both directions by
hand. If the role protocol keeps LangGraph, this is the seam to revisit: either
adopt `langchain_anthropic.ChatAnthropic` (and lose the guard's single-choke
-point over the raw client) or keep hand-rolling this.

to_anthropic:  state.messages (Human/AI/Tool) -> (system unused here, list[dict])
from_anthropic: an Anthropic Message response -> one AIMessage with tool_calls

Anthropic constraints honoured here:
  * messages alternate user/assistant and start with user;
  * an assistant turn that called tools is a list of content blocks
    (text + tool_use);
  * every tool_result rides in the *user* turn immediately after, and multiple
    results from one assistant turn are grouped into a single user message.
"""
from __future__ import annotations

from typing import Any

from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    ToolMessage,
)


def _text_of(content: Any) -> str:
    """Flatten LangChain message content to plain text."""
    if isinstance(content, str):
        return content
    parts = []
    for block in content or ():
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


def to_anthropic(messages: list[AnyMessage]) -> list[dict]:
    """Translate the LangChain history into Anthropic `messages` param dicts.

    Consecutive ToolMessages are folded into one user turn of tool_result
    blocks, which is what the API requires after a tool-calling assistant turn.
    """
    out: list[dict] = []
    pending_results: list[dict] = []

    def flush_results():
        if pending_results:
            out.append({"role": "user", "content": list(pending_results)})
            pending_results.clear()

    for m in messages:
        if isinstance(m, ToolMessage):
            pending_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id,
                    "content": m.content if isinstance(m.content, str) else str(m.content),
                }
            )
            continue

        flush_results()

        if isinstance(m, HumanMessage):
            out.append({"role": "user", "content": _text_of(m.content)})
        elif isinstance(m, AIMessage):
            blocks: list[dict] = []
            text = _text_of(m.content)
            if text:
                blocks.append({"type": "text", "text": text})
            for tc in m.tool_calls or ():
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc.get("args", {}),
                    }
                )
            # An assistant turn is never empty; if the model returned nothing at
            # all, emit a single empty text block so the wire stays valid.
            out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
        else:  # pragma: no cover - system handled out of band
            raise TypeError(f"unexpected message type in history: {type(m).__name__}")

    flush_results()
    return out


def from_anthropic(response: Any) -> AIMessage:
    """Translate one Anthropic Message response into a LangChain AIMessage.

    Text blocks become the message content; tool_use blocks become
    `tool_calls` in LangChain shape ({name, args, id}) so ToolNode can dispatch
    them. to_anthropic reconstructs the tool_use blocks from these on the next
    call, so the round trip is lossless for what the loop needs.
    """
    text_parts: list[str] = []
    tool_calls: list[dict] = []
    for block in response.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            text_parts.append(block.text)
        elif btype == "tool_use":
            tool_calls.append(
                {"name": block.name, "args": dict(block.input), "id": block.id}
            )
    return AIMessage(content="".join(text_parts), tool_calls=tool_calls)

import os
import random
import anthropic

from .anthropic_key import KEY

client = anthropic.Anthropic(api_key=KEY)  # reads ANTHROPIC_API_KEY from env

MODEL = "claude-sonnet-5"
MAX_ITERS = 6

# Point these at your real files locally.
CORPUS_PATH = "discourse-spaces/free-transit.v2.yaml"
SOURCE_SNIPPET = (
    "Fare-free transit in Tallinn did not meaningfully reduce car use; "
    "most new riders shifted from walking and cycling, not driving."
)

# ---- tool declarations ----
tools = [
    {
        "name": "read_source",
        "description": (
            "Return the source snippet the agent is working from. "
            "Call this to see the raw material before deciding what to add."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "read_corpus",
        "description": (
            "Return the current corpus as raw YAML text. Call this to see "
            "what claims and inferences already exist before proposing anything."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]

# ---- tool implementations (our side) ----
def read_source():
    return SOURCE_SNIPPET

def read_corpus():
    if not os.path.exists(CORPUS_PATH):
        # deliberately return this rather than crashing — Step 3 turns
        # this kind of thing into a recoverable error fed back to the model
        return f"ERROR: corpus file not found at {CORPUS_PATH}"
    with open(CORPUS_PATH, "r") as f:
        return f.read()

TOOL_IMPL = {"read_source": read_source, "read_corpus": read_corpus}

# ---- the loop ----
messages = [
    {
        "role": "user",
        "content": (
            "You are examining an argument corpus. First understand the source "
            "material and the existing corpus. Use your tools to gather what you "
            "need. When you have read both the source and the corpus, summarise "
            "in 2-3 sentences what the source claims and whether the corpus "
            "already covers it. Then reply DONE and stop. Do not propose edits yet."
        ),
    }
]

hit_cap = True

for turn in range(1, MAX_ITERS + 1):
    print(f"\n=== turn {turn} ===")

    resp = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=tools,
        messages=messages,
    )
    print("stop_reason:", resp.stop_reason)

    # observability: show any reasoning text the model emitted this turn
    for block in resp.content:
        if block.type == "text" and block.text.strip():
            print("  think:", block.text.strip()[:300])

    messages.append({"role": "assistant", "content": resp.content})

    if resp.stop_reason != "tool_use":
        hit_cap = False
        break

    tool_results = []
    for block in resp.content:
        if block.type == "tool_use":
            print(f"  -> calls {block.name}({block.input})")
            output = TOOL_IMPL[block.name](**block.input)
            preview = output if len(output) < 120 else output[:120] + f"... [{len(output)} chars]"
            print(f"  <- {preview}")
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(output),
            })

    messages.append({"role": "user", "content": tool_results})

    # rough context-growth signal: total characters carried into next call
    total_chars = sum(
        len(str(m["content"])) for m in messages
    )
    print(f"  [context now ~{total_chars} chars across {len(messages)} messages]")

if hit_cap:
    print(f"\n*** HIT ITERATION CAP ({MAX_ITERS}) ***")

print(f"\nfinal history: {len(messages)} messages")

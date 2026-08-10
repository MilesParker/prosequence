import random
import anthropic
from anthropic.types import MessageParam, ToolParam, ToolResultBlockParam

from .anthropic_key import KEY

client = anthropic.Anthropic(api_key=KEY)  # reads ANTHROPIC_API_KEY from env

MODEL = "claude-sonnet-4-5"   # confirm against your account's model list
MAX_ITERS = 5                 # the hard cap — the safety net

# ---- tool declaration (sent to the model) ----
tools: list[ToolParam] = [
    {
        "name": "get_random_number",
        "description": "Return a random integer between 1 and 10 inclusive.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    }
]

# ---- tool implementation (stays on our side; model never touches it) ----
def get_random_number():
    n = random.randint(1, 10)
    return n

TOOL_IMPL = {"get_random_number": get_random_number}

# ---- the loop ----
messages: list[MessageParam] = [
    {
        "role": "user",
        "content": (
            "Call get_random_number repeatedly until you get a number greater "
            "than 8. When you do, reply with the single word DONE and stop."
        ),
    }
]

hit_cap = True  # assume we cap unless the model signals done first

for turn in range(1, MAX_ITERS + 1):
    print(f"\n=== turn {turn} ===")

    resp = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=tools,
        messages=messages,
    )
    print("stop_reason:", resp.stop_reason)

    # record the model's turn in the running history
    messages.append({"role": "assistant", "content": resp.content})

    # model didn't ask for a tool -> it's done deciding
    if resp.stop_reason != "tool_use":
        for block in resp.content:
            if block.type == "text":
                print("model says:", block.text.strip())
        hit_cap = False
        break

    # otherwise: run each requested tool, collect results
    tool_results: list[ToolResultBlockParam] = []
    for block in resp.content:
        if block.type == "tool_use":
            print(f"  -> model calls {block.name}({block.input})")
            output = TOOL_IMPL[block.name](**block.input)
            print(f"  <- result: {output}")
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(output),   # tool_result content must be a string
            })

    # feed results back as the next 'user' turn
    messages.append({"role": "user", "content": tool_results})

if hit_cap:
    print(f"\n*** HIT ITERATION CAP ({MAX_ITERS}) — forced stop ***")

print(f"\nfinal message history length: {len(messages)} messages")
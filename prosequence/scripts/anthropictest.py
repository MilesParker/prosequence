import anthropic
from anthropic.types import ToolParam
from .anthropic_key import KEY

client = anthropic.Anthropic(api_key=KEY)  # reads ANTHROPIC_API_KEY from env

# One tool, deliberately trivial. We're testing the round-trip, not the tool.
tools: list[ToolParam] = [
    {
        "name": "read_source",
        "description": "Return the source snippet the agent should work from.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    }
]

resp = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    tools=tools,
    messages=[
        {"role": "user", "content": "Call read_source to get started."}
    ],
)

print("stop_reason:", resp.stop_reason)
for block in resp.content:
    print("block type:", block.type)
    if block.type == "tool_use":
        print("  tool name:", block.name)
        print("  tool input:", block.input)
        print("  tool_use id:", block.id)
    elif block.type == "text":
        print("  text:", block.text)
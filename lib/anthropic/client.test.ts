import { describe, expect, it } from "vitest";
import { buildAnthropicRequestBody, type AnthropicTool } from "@/lib/anthropic/client";

const tool: AnthropicTool = {
  name: "record_thing",
  description: "records a thing",
  input_schema: { type: "object", properties: {}, required: [] },
};

describe("buildAnthropicRequestBody", () => {
  it("forces tool use on the given tool", () => {
    const body = buildAnthropicRequestBody({
      system: "system prompt",
      userMessage: "user message",
      tool,
    });
    expect(body).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: "system prompt",
      messages: [{ role: "user", content: "user message" }],
      tools: [tool],
      tool_choice: { type: "tool", name: "record_thing" },
    });
  });
});

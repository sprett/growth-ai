const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-sonnet-5";

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AnthropicToolCall = {
  system: string;
  userMessage: string;
  tool: AnthropicTool;
};

export function buildAnthropicRequestBody(
  input: AnthropicToolCall,
): Record<string, unknown> {
  return {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: input.system,
    messages: [{ role: "user", content: input.userMessage }],
    tools: [input.tool],
    tool_choice: { type: "tool", name: input.tool.name },
  };
}

async function readAnthropicError(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 280) || `Anthropic HTTP ${response.status}`;
}

export async function callAnthropicTool(
  input: AnthropicToolCall,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildAnthropicRequestBody(input)),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic request failed (${response.status}): ${await readAnthropicError(response)}`,
    );
  }

  const payload = (await response.json()) as {
    content: Array<{ type: string; input?: Record<string, unknown> }>;
  };

  const toolUse = payload.content.find((block) => block.type === "tool_use");
  if (!toolUse?.input) {
    throw new Error("Anthropic response did not include a tool_use block");
  }

  return toolUse.input;
}

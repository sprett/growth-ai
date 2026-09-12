import type { NormalizedSpec } from "@/lib/pipeline/auth-copy";

export type PlannedEdit = {
  path: string;
  before: string;
  content: string;
};

const SKIP_PATH = /(^|\/)(node_modules|dist|\.next|\.git|\.claude|coverage|build)(\/|$)/;
const NESTED_APP_COPY = /(^|\/)Student_App\//;
const UI_SOURCE = /\.(tsx|jsx|vue|css)$/;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "change",
  "color",
  "colour",
  "copy",
  "for",
  "in",
  "make",
  "of",
  "on",
  "or",
  "placement",
  "please",
  "screen",
  "the",
  "to",
  "try",
  "ui",
  "want",
]);

export function selectUiSourceFiles(paths: string[]): string[] {
  return paths
    .filter((path) => {
      if (SKIP_PATH.test(path)) return false;
      if (NESTED_APP_COPY.test(path)) return false;
      return UI_SOURCE.test(path);
    })
    .sort();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function scorePath(path: string, tokens: string[]): number {
  const hay = path.toLowerCase();
  const fileName = path.split("/").pop()?.toLowerCase() ?? "";
  let score = 0;
  for (const token of tokens) {
    if (fileName.includes(token)) score += 8;
    else if (hay.includes(token)) score += 3;
  }
  return score;
}

export function rankCandidateFiles(
  paths: string[],
  input: { element: string; promptText?: string },
): string[] {
  const tokens = [...new Set([...tokenize(input.element), ...tokenize(input.promptText ?? "")])];
  return selectUiSourceFiles(paths)
    .map((path) => ({ path, score: scorePath(path, tokens) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((entry) => entry.path);
}

export function parseFileEditReply(raw: unknown, allowedPaths: string[]): PlannedEdit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Model reply was not a file edit object.");
  }

  const record = raw as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  const before = typeof record.before === "string" ? record.before : "";
  const content = typeof record.content === "string" ? record.content : "";

  if (!path) {
    throw new Error("File edit is missing path.");
  }
  if (!allowedPaths.includes(path)) {
    throw new Error(`Proposed path "${path}" is not one of the candidate files.`);
  }
  if (content.trim().length === 0) {
    throw new Error("File edit content is empty.");
  }

  return { path, before, content };
}

export function stripPlannedFileContent(
  hypothesis: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...hypothesis };
  delete next.file_content;
  return next;
}

export function extractJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through — maybe the JSON is embedded in surrounding prose
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function buildFileEditPrompt(
  spec: NormalizedSpec,
  promptText: string,
  files: { path: string; content: string }[],
): string {
  const fileBlocks = files
    .map((file) => `----- ${file.path} -----\n${file.content}`)
    .join("\n\n");

  return `You are a growth agent applying a UI A/B test to a customer's app.

User request: """${promptText}"""

Parsed hypothesis:
- element: ${spec.element}
- dimension: ${spec.dimension}
- variant_value: ${spec.variant_value}

Candidate source files (path + current contents):
${fileBlocks}

Pick exactly one of those files and apply the smallest change that implements the hypothesis.
Keep every other line identical. Do not refactor, rename, or reformat unrelated code.

Reply with ONLY a JSON object, no markdown:
{
  "path": "<one of the candidate paths above>",
  "before": "<the original snippet you replaced>",
  "content": "<the complete new file contents>"
}`;
}

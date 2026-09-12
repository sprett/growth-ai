# Chat → Real PR + Real Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing chat UI to actually run parse→diff→open-PR (against a mocked GitHub client) and real PostHog flag creation, and restyle the chat to a ChatGPT/Claude-style transcript with inline step cards.

**Architecture:** `lib/pipeline/steps.ts`'s stubs become real: `parseRequest` calls Anthropic once (retrying once on a validation failure) to extract `{element, dimension, value, rationale}`; `generateDiff` is a **deterministic** transform (not a second LLM call — the tunable surface is a fixed 3×2 schema, so mechanically applying the parsed spec to a known object literal is more reliable than asking an LLM to re-emit correct TypeScript, per the original spec's own risk mitigation in `docs/growth-agent-spec.md` §9); `openPr` calls a `GithubClient` interface whose only implementation right now is a mock (a teammate owns the real Octokit client and will swap it in behind `lib/github/index.ts`); `createFlag` calls the already-real `lib/posthog/flags.ts`. `app/actions/experiment.ts` runs the chain synchronously and returns a timeline the chat renders as staggered step cards.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (Postgres + service-role admin client), plain `fetch` wrappers for external APIs (Anthropic Messages API, PostHog, GitHub REST — no new SDK dependencies, matching the existing `lib/posthog/customer.ts` pattern), Vitest for pure-function unit tests, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-12-chat-to-pr-and-flags-design.md`

## Global Constraints

- Tunable surface is fixed: `element ∈ {cta_button, headline, tagline}`, `dimension ∈ {copy, color}`, and `color` is only valid when `element = cta_button`. Never widen this.
- Do not add an Octokit dependency or write real commits/PRs to `denizsaether/Student_App`. GitHub stays behind the `GithubClient` interface with only the mock implementation. That's a teammate's parallel work.
- External API calls use plain `fetch`, not SDKs — matches `lib/posthog/customer.ts`'s existing `posthogRequest` pattern.
- Anthropic model: `claude-sonnet-5`. Key comes from `process.env.ANTHROPIC_API_KEY` (already set in `.env`).
- The real org to test against is `org_id = 0b086141-730c-41de-bee3-cc85ea21043f` (real `github_installation_id`, real PostHog project `272715` on EU cloud). Target repo: `denizsaether/Student_App`, file `frontend/src/AuthPanel.tsx`.
- Package manager is `pnpm`. Node is pinned to 22 in `.nvmrc` — run `pnpm`/`node` commands with that version active; `@supabase/supabase-js` crashes under Node 20 (no global `WebSocket`). None of the new unit tests import `@supabase/supabase-js`, so `pnpm test` is unaffected either way.
- Existing `StepResult` consumers: none outside `lib/pipeline/`. `lib/pipeline/run.ts` has zero importers anywhere in the codebase (verified with `grep -rn "runStep" .`) — it will be deleted, not adapted, once step signatures change (Task 7).
- **Task order matters for typechecking**: the webhook route (Task 8) calls `createFlag` with the signature `steps.ts` gets in Task 7. Task 8 is deliberately placed after Task 7 so the tree typechecks cleanly at every commit from Task 7 onward. Don't reorder.

---

## Task 1: Vitest setup + `slugify`

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDependency, add `"test": "vitest run"` script)
- Modify: `lib/utils.ts` (add `slugify`)
- Test: `lib/utils.test.ts`

**Interfaces:**
- Produces: `slugify(text: string): string` — lowercases, replaces runs of non-alphanumeric characters with a single `-`, trims leading/trailing `-`. Used later (Task 7) for branch names.

- [ ] **Step 1: Add Vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Create the Vitest config**

```ts
// vitest.config.ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, inside `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the failing test**

```ts
// lib/utils.test.ts
import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/utils";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Kom i gang!")).toBe("kom-i-gang");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("  Multiple   Spaces -- here ")).toBe("multiple-spaces-here");
  });

  it("returns an empty string for input with no alphanumerics", () => {
    expect(slugify("!!!")).toBe("");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `slugify is not exported from "@/lib/utils"` (or similar).

- [ ] **Step 6: Implement `slugify`**

Add to `lib/utils.ts` (keep the existing `cn` export as-is):

```ts
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts lib/utils.ts lib/utils.test.ts
git commit -m "test: add Vitest and slugify utility"
```

---

## Task 2: Anthropic client wrapper

**Files:**
- Create: `lib/anthropic/client.ts`
- Test: `lib/anthropic/client.test.ts`

**Interfaces:**
- Produces:
  - `type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> }`
  - `buildAnthropicRequestBody(input: { system: string; userMessage: string; tool: AnthropicTool }): Record<string, unknown>` (pure, tested)
  - `callAnthropicTool(input: { system: string; userMessage: string; tool: AnthropicTool }): Promise<Record<string, unknown>>` (thin fetch wrapper, not unit tested — verified manually in Task 12)

- [ ] **Step 1: Write the failing test for the pure request-body builder**

```ts
// lib/anthropic/client.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/anthropic/client.test.ts`
Expected: FAIL — module `@/lib/anthropic/client` has no exported member `buildAnthropicRequestBody`.

- [ ] **Step 3: Implement the client**

```ts
// lib/anthropic/client.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/anthropic/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/anthropic/client.ts lib/anthropic/client.test.ts
git commit -m "feat: add Anthropic tool-call client wrapper"
```

---

## Task 3: Parsed-spec schema and validation

**Files:**
- Create: `lib/pipeline/parse-schema.ts`
- Test: `lib/pipeline/parse-schema.test.ts`

**Interfaces:**
- Consumes: `AnthropicTool` from `@/lib/anthropic/client` (Task 2).
- Produces:
  - `type TunableElement = "cta_button" | "headline" | "tagline"`
  - `type TunableDimension = "copy" | "color"`
  - `type ParsedExperimentSpec = { element: TunableElement; dimension: TunableDimension; value: string; rationale: string }`
  - `PARSE_EXPERIMENT_TOOL: AnthropicTool`
  - `validateParsedSpec(raw: unknown): ParsedExperimentSpec` — throws `Error` with a human-readable message on any invalid shape, including the `color` + non-`cta_button` combination.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/pipeline/parse-schema.test.ts
import { describe, expect, it } from "vitest";
import { validateParsedSpec } from "@/lib/pipeline/parse-schema";

describe("validateParsedSpec", () => {
  it("accepts a valid copy change", () => {
    expect(
      validateParsedSpec({
        element: "cta_button",
        dimension: "copy",
        value: "Kom i gang",
        rationale: "Shorter, more direct CTA.",
      }),
    ).toEqual({
      element: "cta_button",
      dimension: "copy",
      value: "Kom i gang",
      rationale: "Shorter, more direct CTA.",
    });
  });

  it("accepts a valid color change on cta_button", () => {
    const spec = validateParsedSpec({
      element: "cta_button",
      dimension: "color",
      value: "bg-emerald-600 hover:bg-emerald-700",
      rationale: "Green reads as go/success.",
    });
    expect(spec.dimension).toBe("color");
  });

  it("rejects color on a non-cta_button element", () => {
    expect(() =>
      validateParsedSpec({
        element: "headline",
        dimension: "color",
        value: "bg-emerald-600",
        rationale: "n/a",
      }),
    ).toThrow(/color/i);
  });

  it("rejects an unknown element", () => {
    expect(() =>
      validateParsedSpec({
        element: "footer",
        dimension: "copy",
        value: "x",
        rationale: "n/a",
      }),
    ).toThrow();
  });

  it("rejects a missing field", () => {
    expect(() =>
      validateParsedSpec({ element: "headline", dimension: "copy", value: "x" }),
    ).toThrow();
  });

  it("rejects a non-object", () => {
    expect(() => validateParsedSpec("nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test lib/pipeline/parse-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema and validator**

```ts
// lib/pipeline/parse-schema.ts
import type { AnthropicTool } from "@/lib/anthropic/client";

export type TunableElement = "cta_button" | "headline" | "tagline";
export type TunableDimension = "copy" | "color";

export type ParsedExperimentSpec = {
  element: TunableElement;
  dimension: TunableDimension;
  value: string;
  rationale: string;
};

const ELEMENTS: TunableElement[] = ["cta_button", "headline", "tagline"];
const DIMENSIONS: TunableDimension[] = ["copy", "color"];

export const PARSE_EXPERIMENT_TOOL: AnthropicTool = {
  name: "record_experiment_spec",
  description:
    "Record the structured A/B test spec extracted from the user's request for the signup screen.",
  input_schema: {
    type: "object",
    properties: {
      element: { type: "string", enum: ELEMENTS },
      dimension: { type: "string", enum: DIMENSIONS },
      value: {
        type: "string",
        description:
          "The new copy text, or a Tailwind class pair like 'bg-emerald-600 hover:bg-emerald-700' when dimension is color.",
      },
      rationale: {
        type: "string",
        description: "One sentence on why this change might help conversion.",
      },
    },
    required: ["element", "dimension", "value", "rationale"],
  },
};

export function validateParsedSpec(raw: unknown): ParsedExperimentSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Parsed spec must be an object");
  }

  const record = raw as Record<string, unknown>;
  const { element, dimension, value, rationale } = record;

  if (typeof element !== "string" || !ELEMENTS.includes(element as TunableElement)) {
    throw new Error(`element must be one of ${ELEMENTS.join(", ")}`);
  }
  if (
    typeof dimension !== "string" ||
    !DIMENSIONS.includes(dimension as TunableDimension)
  ) {
    throw new Error(`dimension must be one of ${DIMENSIONS.join(", ")}`);
  }
  if (dimension === "color" && element !== "cta_button") {
    throw new Error("color changes are only supported on cta_button");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("value must be a non-empty string");
  }
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    throw new Error("rationale must be a non-empty string");
  }

  return {
    element: element as TunableElement,
    dimension: dimension as TunableDimension,
    value,
    rationale,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lib/pipeline/parse-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/parse-schema.ts lib/pipeline/parse-schema.test.ts
git commit -m "feat: add parsed experiment spec schema and validator"
```

---

## Task 4: AuthPanel copy model (fixture + deterministic apply + PR body)

**Files:**
- Create: `lib/pipeline/target-fixtures.ts`
- Create: `lib/pipeline/auth-copy.ts`
- Test: `lib/pipeline/auth-copy.test.ts`

**Interfaces:**
- Consumes: `ParsedExperimentSpec` from `@/lib/pipeline/parse-schema` (Task 3).
- Produces:
  - `AUTH_PANEL_PATH = "frontend/src/AuthPanel.tsx"`
  - `type AuthCopyEntry = { headline: string; tagline: string; ctaLabel: string; ctaColorClass: string }`
  - `type AuthCopyBlock = { signin: AuthCopyEntry; signup: AuthCopyEntry }`
  - `AUTH_COPY_DEFAULT: AuthCopyBlock`
  - `serializeAuthCopyBlock(block: AuthCopyBlock): string`
  - `AUTH_COPY_FIXTURE: string` (= `serializeAuthCopyBlock(AUTH_COPY_DEFAULT)`)
  - `applyExperimentSpec(base: AuthCopyBlock, spec: ParsedExperimentSpec): AuthCopyBlock` — only ever mutates `base.signup`, returns a new object, throws on an unsupported combination.
  - `pickEntryField(entry: AuthCopyEntry, spec: Pick<ParsedExperimentSpec, "element" | "dimension">): string`
  - `buildPrBody(spec: ParsedExperimentSpec, before: AuthCopyEntry, after: AuthCopyEntry): string`

- [ ] **Step 1: Create the fixture file (no test needed — it's data)**

```ts
// lib/pipeline/target-fixtures.ts
export const AUTH_PANEL_PATH = "frontend/src/AuthPanel.tsx";

export type AuthCopyEntry = {
  headline: string;
  tagline: string;
  ctaLabel: string;
  ctaColorClass: string;
};

export type AuthCopyBlock = {
  signin: AuthCopyEntry;
  signup: AuthCopyEntry;
};

export const AUTH_COPY_DEFAULT: AuthCopyBlock = {
  signin: {
    headline: "Logg inn",
    tagline: "Logg inn for å synkronisere fag og timer på tvers av enheter.",
    ctaLabel: "Logg inn",
    ctaColorClass: "bg-blue-600 hover:bg-blue-700",
  },
  signup: {
    headline: "Opprett konto",
    tagline: "Opprett konto med e-post. Du kan bli bedt om å bekrefte e-posten.",
    ctaLabel: "Opprett konto",
    ctaColorClass: "bg-blue-600 hover:bg-blue-700",
  },
};

export function serializeAuthCopyBlock(block: AuthCopyBlock): string {
  const entry = (e: AuthCopyEntry) => `{
    headline: ${JSON.stringify(e.headline)},
    tagline: ${JSON.stringify(e.tagline)},
    ctaLabel: ${JSON.stringify(e.ctaLabel)},
    ctaColorClass: ${JSON.stringify(e.ctaColorClass)},
  }`;

  return `export const AUTH_COPY = {
  signin: ${entry(block.signin)},
  signup: ${entry(block.signup)},
};
`;
}

export const AUTH_COPY_FIXTURE = serializeAuthCopyBlock(AUTH_COPY_DEFAULT);
```

- [ ] **Step 2: Write the failing tests for the copy-model logic**

```ts
// lib/pipeline/auth-copy.test.ts
import { describe, expect, it } from "vitest";
import { AUTH_COPY_DEFAULT } from "@/lib/pipeline/target-fixtures";
import { applyExperimentSpec, buildPrBody, pickEntryField } from "@/lib/pipeline/auth-copy";
import type { ParsedExperimentSpec } from "@/lib/pipeline/parse-schema";

const baseSpec: ParsedExperimentSpec = {
  element: "cta_button",
  dimension: "copy",
  value: "Kom i gang",
  rationale: "Shorter CTA.",
};

describe("applyExperimentSpec", () => {
  it("updates cta_button/copy on signup only, leaving signin untouched", () => {
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, baseSpec);
    expect(next.signup.ctaLabel).toBe("Kom i gang");
    expect(next.signin).toEqual(AUTH_COPY_DEFAULT.signin);
    expect(AUTH_COPY_DEFAULT.signup.ctaLabel).toBe("Opprett konto"); // original untouched
  });

  it("updates cta_button/color", () => {
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, {
      ...baseSpec,
      dimension: "color",
      value: "bg-emerald-600 hover:bg-emerald-700",
    });
    expect(next.signup.ctaColorClass).toBe("bg-emerald-600 hover:bg-emerald-700");
    expect(next.signup.ctaLabel).toBe(AUTH_COPY_DEFAULT.signup.ctaLabel);
  });

  it("updates headline/copy", () => {
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, {
      ...baseSpec,
      element: "headline",
      value: "Bli med",
    });
    expect(next.signup.headline).toBe("Bli med");
  });

  it("updates tagline/copy", () => {
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, {
      ...baseSpec,
      element: "tagline",
      value: "Kom i gang på ti sekunder.",
    });
    expect(next.signup.tagline).toBe("Kom i gang på ti sekunder.");
  });

  it("throws on an unsupported combination", () => {
    expect(() =>
      applyExperimentSpec(AUTH_COPY_DEFAULT, {
        ...baseSpec,
        element: "headline",
        dimension: "color",
        value: "bg-emerald-600",
      }),
    ).toThrow();
  });
});

describe("pickEntryField", () => {
  it("reads the field the spec targets", () => {
    expect(pickEntryField(AUTH_COPY_DEFAULT.signup, baseSpec)).toBe("Opprett konto");
  });
});

describe("buildPrBody", () => {
  it("mentions the element, before, after, and rationale", () => {
    const after = applyExperimentSpec(AUTH_COPY_DEFAULT, baseSpec).signup;
    const body = buildPrBody(baseSpec, AUTH_COPY_DEFAULT.signup, after);
    expect(body).toContain("cta_button");
    expect(body).toContain("Opprett konto");
    expect(body).toContain("Kom i gang");
    expect(body).toContain("Shorter CTA.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test lib/pipeline/auth-copy.test.ts`
Expected: FAIL — module `@/lib/pipeline/auth-copy` not found.

- [ ] **Step 4: Implement `lib/pipeline/auth-copy.ts`**

```ts
// lib/pipeline/auth-copy.ts
import type { ParsedExperimentSpec } from "@/lib/pipeline/parse-schema";
import type { AuthCopyBlock, AuthCopyEntry } from "@/lib/pipeline/target-fixtures";

type FieldSpec = Pick<ParsedExperimentSpec, "element" | "dimension">;

function fieldFor(spec: FieldSpec): keyof AuthCopyEntry {
  if (spec.element === "cta_button" && spec.dimension === "copy") return "ctaLabel";
  if (spec.element === "cta_button" && spec.dimension === "color") return "ctaColorClass";
  if (spec.element === "headline" && spec.dimension === "copy") return "headline";
  if (spec.element === "tagline" && spec.dimension === "copy") return "tagline";
  throw new Error(`Unsupported combination: ${spec.element}/${spec.dimension}`);
}

export function pickEntryField(entry: AuthCopyEntry, spec: FieldSpec): string {
  return entry[fieldFor(spec)];
}

export function applyExperimentSpec(
  base: AuthCopyBlock,
  spec: ParsedExperimentSpec,
): AuthCopyBlock {
  const field = fieldFor(spec);
  return {
    signin: { ...base.signin },
    signup: { ...base.signup, [field]: spec.value },
  };
}

export function buildPrBody(
  spec: ParsedExperimentSpec,
  before: AuthCopyEntry,
  after: AuthCopyEntry,
): string {
  const field = fieldFor(spec);
  return [
    `**Experiment:** ${spec.element} / ${spec.dimension}`,
    "",
    `- Before: \`${before[field]}\``,
    `- After: \`${after[field]}\``,
    "",
    `**Rationale:** ${spec.rationale}`,
    "",
    "_Opened by the growth agent. Merge to run this as a live PostHog experiment._",
  ].join("\n");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test lib/pipeline/auth-copy.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline/target-fixtures.ts lib/pipeline/auth-copy.ts lib/pipeline/auth-copy.test.ts
git commit -m "feat: add AuthPanel copy fixture and deterministic spec application"
```

---

## Task 5: GithubClient interface + mock

**Files:**
- Create: `lib/github/types.ts`
- Create: `lib/github/mock-client.ts`
- Create: `lib/github/index.ts`
- Test: `lib/github/mock-client.test.ts`

**Interfaces:**
- Produces:
  - `type GithubTarget = { installationId: string; repoFullName: string; baseBranch: string }`
  - `type FileEdit = { path: string; content: string }`
  - `type OpenPrInput = { target: GithubTarget; branchName: string; commitMessage: string; prTitle: string; prBody: string; files: FileEdit[] }`
  - `type OpenPrResult = { prUrl: string; prNumber: number; branchName: string }`
  - `interface GithubClient { openPullRequest(input: OpenPrInput): Promise<OpenPrResult> }`
  - `createMockGithubClient(startAt?: number): GithubClient`
  - `getGithubClient(): GithubClient` — the swap point for the real Octokit client, used by Task 7's `openPr`.

- [ ] **Step 1: Define the interface types**

```ts
// lib/github/types.ts
export type GithubTarget = {
  installationId: string;
  repoFullName: string;
  baseBranch: string;
};

export type FileEdit = { path: string; content: string };

export type OpenPrInput = {
  target: GithubTarget;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: FileEdit[];
};

export type OpenPrResult = {
  prUrl: string;
  prNumber: number;
  branchName: string;
};

export interface GithubClient {
  openPullRequest(input: OpenPrInput): Promise<OpenPrResult>;
}
```

- [ ] **Step 2: Write the failing test for the mock client**

```ts
// lib/github/mock-client.test.ts
import { describe, expect, it } from "vitest";
import { createMockGithubClient } from "@/lib/github/mock-client";
import type { OpenPrInput } from "@/lib/github/types";

const input: OpenPrInput = {
  target: { installationId: "123", repoFullName: "denizsaether/Student_App", baseBranch: "main" },
  branchName: "growth-agent/cycle-1-kom-i-gang",
  commitMessage: "Experiment: cta_button copy",
  prTitle: "Growth agent: cta_button copy experiment",
  prBody: "body",
  files: [{ path: "frontend/src/AuthPanel.tsx", content: "export const AUTH_COPY = {};" }],
};

describe("createMockGithubClient", () => {
  it("returns a PR URL built from the repo and an incrementing number", async () => {
    const client = createMockGithubClient(100);
    const first = await client.openPullRequest(input);
    expect(first.prNumber).toBe(101);
    expect(first.prUrl).toBe("https://github.com/denizsaether/Student_App/pull/101");
    expect(first.branchName).toBe(input.branchName);

    const second = await client.openPullRequest(input);
    expect(second.prNumber).toBe(102);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test lib/github/mock-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the mock client**

```ts
// lib/github/mock-client.ts
import type { GithubClient, OpenPrInput, OpenPrResult } from "@/lib/github/types";

export function createMockGithubClient(startAt = 100): GithubClient {
  let counter = startAt;

  return {
    async openPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
      counter += 1;
      const prNumber = counter;

      console.log(
        `[mock-github] would open PR #${prNumber} on ${input.target.repoFullName} ` +
          `(branch ${input.branchName}, ${input.files.length} file(s) changed)`,
      );
      for (const file of input.files) {
        console.log(`[mock-github]   ${file.path} (${file.content.length} chars)`);
      }

      return {
        prUrl: `https://github.com/${input.target.repoFullName}/pull/${prNumber}`,
        prNumber,
        branchName: input.branchName,
      };
    },
  };
}
```

- [ ] **Step 5: Implement the factory / swap point**

```ts
// lib/github/index.ts
import { createMockGithubClient } from "@/lib/github/mock-client";
import type { GithubClient } from "@/lib/github/types";

export * from "@/lib/github/types";

/**
 * Single swap point: replace this with the real Octokit-backed client once
 * it lands, without touching any caller.
 */
export function getGithubClient(): GithubClient {
  return createMockGithubClient();
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test lib/github/mock-client.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/github/types.ts lib/github/mock-client.ts lib/github/index.ts lib/github/mock-client.test.ts
git commit -m "feat: add GithubClient interface and mock implementation"
```

---

## Task 6: Shared pipeline-step display metadata

**Files:**
- Create: `lib/pipeline/step-meta.ts`
- Modify: `app/operator/page.tsx`

**Interfaces:**
- Produces: `STEP_META: Record<PipelineStepName, { label: string; icon: LucideIcon }>`
- Consumed by: `app/operator/page.tsx` (this task) and `components/experiment-chat.tsx` (Task 11).

- [ ] **Step 1: Extract the metadata**

```ts
// lib/pipeline/step-meta.ts
import {
  Activity,
  BarChart3,
  BookOpen,
  Flag,
  GitPullRequest,
  MessageSquareText,
  Sparkles,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import type { PipelineStepName } from "@/lib/pipeline/types";

export const STEP_META: Record<PipelineStepName, { label: string; icon: LucideIcon }> = {
  parse_request: { label: "Parse request", icon: MessageSquareText },
  generate_diff: { label: "Generate diff", icon: SquarePen },
  open_pr: { label: "Open PR", icon: GitPullRequest },
  create_flag: { label: "Create flag", icon: Flag },
  simulate_traffic: { label: "Simulate traffic", icon: Activity },
  analyze_results: { label: "Analyze results", icon: BarChart3 },
  update_playbook: { label: "Update playbook", icon: BookOpen },
  synthesize_next: { label: "Synthesize next hypothesis", icon: Sparkles },
};
```

- [ ] **Step 2: Update `app/operator/page.tsx` to use it**

Replace the local `steps` array and its import list. Change:

```ts
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Flag,
  GitPullRequest,
  MessageSquareText,
  Sparkles,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
```

to:

```ts
import { STEP_META } from "@/lib/pipeline/step-meta";
import { ArrowLeft } from "lucide-react";
```

Remove the local `const steps: { label: string; icon: LucideIcon }[] = [...]` block entirely, and change the render:

```tsx
<ol className="m-0 list-none border-t border-ink/20 p-0">
  {Object.entries(STEP_META).map(([stepName, meta], index) => (
    <li
      key={stepName}
      className="grid grid-cols-[48px_auto_1fr_auto] items-center gap-3 border-b border-ink/15 py-3"
    >
      <span className="font-mono text-xs text-mute">
        {String(index + 1).padStart(2, "0")}
      </span>
      <meta.icon className="size-4 text-mute" strokeWidth={1.75} />
      <span>{meta.label}</span>
      <span className="font-mono text-xs text-mute">stub</span>
    </li>
  ))}
</ol>
```

- [ ] **Step 3: Verify it still compiles and renders the same labels**

Run: `pnpm typecheck`
Expected: no errors.

Run `pnpm dev`, open `/operator` while signed in, and confirm the same 8 step rows render in the same order as before (Parse request … Synthesize next hypothesis).

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/step-meta.ts app/operator/page.tsx
git commit -m "refactor: share pipeline step display metadata"
```

---

## Task 7: Real pipeline steps

**Files:**
- Modify: `lib/pipeline/types.ts` (make `StepResult` generic)
- Modify: `lib/pipeline/steps.ts` (replace `parseRequest`, `generateDiff`, `openPr`, `createFlag`)
- Delete: `lib/pipeline/run.ts` (zero importers anywhere in the codebase — confirmed by `grep -rn "runStep" .` — and its dispatcher signature can't express the per-step data each new function needs; `app/actions/experiment.ts`, Task 10, calls the step functions directly instead)

**Interfaces:**
- Consumes: `callAnthropicTool`, `PARSE_EXPERIMENT_TOOL` (Task 2/3), `validateParsedSpec`, `ParsedExperimentSpec` (Task 3), `AUTH_COPY_DEFAULT`, `AUTH_PANEL_PATH` (Task 4), `applyExperimentSpec`, `pickEntryField`, `buildPrBody` (Task 4), `serializeAuthCopyBlock` (Task 4), `getGithubClient` (Task 5), `slugify` (Task 1), `createMultivariateFlag` (existing `lib/posthog/flags.ts`), `getActiveConnection`, `assertGithubTarget`, `assertPosthogTarget` (existing `lib/pipeline/connection.ts`), `createAdminSupabase` (existing `lib/supabase-admin.ts`).
- Produces (new signatures — **breaking change** from the current stubs; Task 10 is the only caller and is written against these; Task 8's webhook route also calls `createFlag` and depends on this task landing first):
  - `parseRequest(orgId: string, promptText: string): Promise<StepResult<ParsedExperimentSpec>>`
  - `generateDiff(orgId: string, parsed: ParsedExperimentSpec): Promise<StepResult<{ path: string; content: string; prBody: string; before: AuthCopyEntry; after: AuthCopyEntry }>>`
  - `openPr(orgId: string, experiment: { id: string; cycleNumber: number }, parsed: ParsedExperimentSpec, diff: { path: string; content: string; prBody: string; before: AuthCopyEntry; after: AuthCopyEntry }): Promise<StepResult<{ prUrl: string; prNumber: number }>>`
  - `createFlag(orgId: string, experimentId: string): Promise<StepResult<{ flagKey: string }>>`
- Unchanged: `simulateTraffic`, `analyzeResults`, `updatePlaybook`, `synthesizeNext` keep their current `(orgId: string) => Promise<StepResult>` stub signatures.

No unit test for this task: every new function's job is to call Anthropic, GitHub (mock), PostHog, and Supabase — there's nothing left to test once those calls are mocked out, and the codebase's existing convention (`savePosthogConnection`, `verifyPosthogAccess`) is to leave DB/network-integration code manually verified rather than test-doubled. Correctness is confirmed end-to-end in Task 12. The one piece of real branching logic here — the retry-once behavior in `parseRequest` — is a thin wrapper around `validateParsedSpec`, which already has full unit coverage from Task 3; re-testing it here would just be re-mocking `callAnthropicTool`.

- [ ] **Step 1: Make `StepResult` generic**

In `lib/pipeline/types.ts`, change:

```ts
export type StepResult = {
  step: PipelineStepName;
  ok: boolean;
  message: string;
};
```

to:

```ts
export type StepResult<T = undefined> = {
  step: PipelineStepName;
  ok: boolean;
  message: string;
  data?: T;
};
```

(Every existing `Promise<StepResult>` annotation on the four untouched stub functions still compiles unchanged — `T` defaults to `undefined` and `data` is optional.)

- [ ] **Step 2: Replace the four steps in `lib/pipeline/steps.ts`**

Keep the file's existing imports for `assertGithubTarget`, `assertPosthogTarget`, `getActiveConnection`, `PipelineStepName`, `StepResult`, and the four untouched stub functions (`simulateTraffic`, `analyzeResults`, `updatePlaybook`, `synthesizeNext` — leave them exactly as they are). Add these imports and replace `parseRequest`, `generateDiff`, `openPr`, `createFlag`:

```ts
import { callAnthropicTool } from "@/lib/anthropic/client";
import { applyExperimentSpec, buildPrBody, pickEntryField } from "@/lib/pipeline/auth-copy";
import {
  PARSE_EXPERIMENT_TOOL,
  validateParsedSpec,
  type ParsedExperimentSpec,
} from "@/lib/pipeline/parse-schema";
import {
  AUTH_COPY_DEFAULT,
  AUTH_PANEL_PATH,
  serializeAuthCopyBlock,
  type AuthCopyEntry,
} from "@/lib/pipeline/target-fixtures";
import { getGithubClient } from "@/lib/github";
import { createMultivariateFlag } from "@/lib/posthog/flags";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { slugify } from "@/lib/utils";

const PARSE_SYSTEM_PROMPT =
  "You turn a plain-language UI experiment request into a structured spec for a " +
  "signup screen. Only cta_button, headline, and tagline are tunable; color changes " +
  "only make sense for cta_button.";

async function requestParsedSpec(
  promptText: string,
  extraReminder?: string,
): Promise<ParsedExperimentSpec> {
  const raw = await callAnthropicTool({
    system: extraReminder ? `${PARSE_SYSTEM_PROMPT} ${extraReminder}` : PARSE_SYSTEM_PROMPT,
    userMessage: promptText,
    tool: PARSE_EXPERIMENT_TOOL,
  });
  return validateParsedSpec(raw);
}

export async function parseRequest(
  orgId: string,
  promptText: string,
): Promise<StepResult<ParsedExperimentSpec>> {
  try {
    await getActiveConnection(orgId);

    let parsed: ParsedExperimentSpec;
    try {
      parsed = await requestParsedSpec(promptText);
    } catch {
      parsed = await requestParsedSpec(
        promptText,
        "Your previous attempt did not match the required shape — element must be exactly " +
          "one of cta_button/headline/tagline, dimension exactly one of copy/color, and " +
          "color is only valid with cta_button. Try again.",
      );
    }

    return {
      step: "parse_request",
      ok: true,
      message: `Parsed as ${parsed.element}/${parsed.dimension} → "${parsed.value}"`,
      data: parsed,
    };
  } catch (error) {
    return {
      step: "parse_request",
      ok: false,
      message: error instanceof Error ? error.message : "Could not parse the request",
    };
  }
}

export async function generateDiff(
  orgId: string,
  parsed: ParsedExperimentSpec,
): Promise<
  StepResult<{ path: string; content: string; prBody: string; before: AuthCopyEntry; after: AuthCopyEntry }>
> {
  try {
    const connection = await getActiveConnection(orgId);
    assertGithubTarget(connection);

    const before = AUTH_COPY_DEFAULT.signup;
    const nextBlock = applyExperimentSpec(AUTH_COPY_DEFAULT, parsed);
    const content = serializeAuthCopyBlock(nextBlock);
    const prBody = buildPrBody(parsed, before, nextBlock.signup);

    return {
      step: "generate_diff",
      ok: true,
      message: `Prepared ${AUTH_PANEL_PATH} with ${parsed.element}/${parsed.dimension} set to "${parsed.value}".`,
      data: { path: AUTH_PANEL_PATH, content, prBody, before, after: nextBlock.signup },
    };
  } catch (error) {
    return {
      step: "generate_diff",
      ok: false,
      message: error instanceof Error ? error.message : "Could not prepare the diff",
    };
  }
}

export async function openPr(
  orgId: string,
  experiment: { id: string; cycleNumber: number },
  parsed: ParsedExperimentSpec,
  diff: { path: string; content: string; prBody: string; before: AuthCopyEntry; after: AuthCopyEntry },
): Promise<StepResult<{ prUrl: string; prNumber: number }>> {
  try {
    const connection = await getActiveConnection(orgId);
    const repo = assertGithubTarget(connection);

    const slug = slugify(parsed.value).slice(0, 32) || "variant";
    const branchName = `growth-agent/cycle-${experiment.cycleNumber}-${slug}`;

    const result = await getGithubClient().openPullRequest({
      target: {
        installationId: connection.github_installation_id ?? "",
        repoFullName: repo,
        baseBranch: "main",
      },
      branchName,
      commitMessage: `Experiment: ${parsed.element} ${parsed.dimension} → ${parsed.value}`,
      prTitle: `Growth agent: ${parsed.element} ${parsed.dimension} experiment`,
      prBody: diff.prBody,
      files: [{ path: diff.path, content: diff.content }],
    });

    const admin = createAdminSupabase();
    const controlValue = pickEntryField(diff.before, parsed);

    const { error: variantError } = await admin.from("variants").insert([
      {
        experiment_id: experiment.id,
        org_id: orgId,
        label: "control",
        element: parsed.element,
        dimension: parsed.dimension,
        value: controlValue,
        pr_url: null,
      },
      {
        experiment_id: experiment.id,
        org_id: orgId,
        label: "variant_b",
        element: parsed.element,
        dimension: parsed.dimension,
        value: parsed.value,
        pr_url: result.prUrl,
      },
    ]);
    if (variantError) {
      throw new Error(variantError.message);
    }

    await admin
      .from("experiments")
      .update({
        status: "pr_open",
        variant_a_description: controlValue,
        variant_b_description: parsed.value,
      })
      .eq("id", experiment.id);

    return {
      step: "open_pr",
      ok: true,
      message: `Opened ${result.prUrl}`,
      data: { prUrl: result.prUrl, prNumber: result.prNumber },
    };
  } catch (error) {
    return {
      step: "open_pr",
      ok: false,
      message: error instanceof Error ? error.message : "Could not open the PR",
    };
  }
}

export async function createFlag(
  orgId: string,
  experimentId: string,
): Promise<StepResult<{ flagKey: string }>> {
  try {
    const connection = await getActiveConnection(orgId);
    const target = assertPosthogTarget(connection);

    const admin = createAdminSupabase();
    const { data: variants, error } = await admin
      .from("variants")
      .select("id, label")
      .eq("experiment_id", experimentId);
    if (error) {
      throw new Error(error.message);
    }
    if (!variants || variants.length === 0) {
      throw new Error("No variants found for this experiment yet.");
    }

    const flagKey = `growth-agent-${experimentId.slice(0, 8)}`;
    await createMultivariateFlag(target, {
      key: flagKey,
      name: `Growth agent experiment ${experimentId.slice(0, 8)}`,
      variants: [
        { key: "control", name: "Control", rollout_percentage: 50 },
        { key: "variant_b", name: "Variant B", rollout_percentage: 50 },
      ],
    });

    const { error: updateError } = await admin
      .from("variants")
      .update({ posthog_flag_key: flagKey })
      .eq("experiment_id", experimentId);
    if (updateError) {
      throw new Error(updateError.message);
    }

    await admin.from("experiments").update({ status: "flag_created" }).eq("id", experimentId);

    return {
      step: "create_flag",
      ok: true,
      message: `Created PostHog flag ${flagKey}`,
      data: { flagKey },
    };
  } catch (error) {
    return {
      step: "create_flag",
      ok: false,
      message: error instanceof Error ? error.message : "PostHog target missing",
    };
  }
}
```

- [ ] **Step 3: Delete the now-incompatible dispatcher**

```bash
rm lib/pipeline/run.ts
```

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm typecheck 2>&1 | grep "lib/pipeline"
```

Expected: no output. (Errors may still exist in `app/actions/experiment.ts` and `components/experiment-chat.tsx` at this point — those are rewritten in Tasks 10 and 11 — so a full unscoped `pnpm typecheck` is expected to still show those two files until Task 10 lands. That's fine for this task's commit.)

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/types.ts lib/pipeline/steps.ts
git rm lib/pipeline/run.ts
git commit -m "feat: replace pipeline step stubs with real Anthropic/GitHub-mock/PostHog calls"
```

---

## Task 8: GitHub merge webhook

**Files:**
- Create: `lib/github/webhook.ts`
- Create: `app/api/github/webhook/route.ts`
- Test: `lib/github/webhook.test.ts`

**Interfaces:**
- Consumes: `createFlag` from `@/lib/pipeline/steps` — this is why this task comes after Task 7: `createFlag`'s real 2-argument signature (`orgId`, `experimentId`) must already exist for `route.ts` to typecheck.
- Produces:
  - `verifyGithubSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean`
  - `type MergedPr = { htmlUrl: string }`
  - `extractMergedPr(payload: unknown): MergedPr | null`

- [ ] **Step 1: Write the failing tests for the pure functions**

```ts
// lib/github/webhook.test.ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractMergedPr, verifyGithubSignature } from "@/lib/github/webhook";

describe("verifyGithubSignature", () => {
  const secret = "test-secret";
  const rawBody = JSON.stringify({ hello: "world" });
  const validSignature =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifyGithubSignature(secret, rawBody, validSignature)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyGithubSignature(secret, rawBody + "x", validSignature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyGithubSignature(secret, rawBody, null)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const wrongSignature =
      "sha256=" + createHmac("sha256", "wrong").update(rawBody, "utf8").digest("hex");
    expect(verifyGithubSignature(secret, rawBody, wrongSignature)).toBe(false);
  });
});

describe("extractMergedPr", () => {
  it("extracts the html_url from a merged, closed PR payload", () => {
    const payload = {
      action: "closed",
      pull_request: { merged: true, html_url: "https://github.com/org/repo/pull/1" },
    };
    expect(extractMergedPr(payload)).toEqual({ htmlUrl: "https://github.com/org/repo/pull/1" });
  });

  it("returns null for a closed-but-not-merged PR", () => {
    const payload = {
      action: "closed",
      pull_request: { merged: false, html_url: "https://github.com/org/repo/pull/1" },
    };
    expect(extractMergedPr(payload)).toBeNull();
  });

  it("returns null for a non-closed action", () => {
    const payload = {
      action: "opened",
      pull_request: { merged: false, html_url: "https://github.com/org/repo/pull/1" },
    };
    expect(extractMergedPr(payload)).toBeNull();
  });

  it("returns null for a malformed payload", () => {
    expect(extractMergedPr("not an object")).toBeNull();
    expect(extractMergedPr(null)).toBeNull();
    expect(extractMergedPr({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test lib/github/webhook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/github/webhook.ts`**

```ts
// lib/github/webhook.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export type MergedPr = { htmlUrl: string };

export function extractMergedPr(payload: unknown): MergedPr | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const body = payload as Record<string, unknown>;
  if (body.action !== "closed") {
    return null;
  }

  const pr = body.pull_request as Record<string, unknown> | undefined;
  if (!pr || pr.merged !== true) {
    return null;
  }

  const htmlUrl = pr.html_url;
  if (typeof htmlUrl !== "string") {
    return null;
  }

  return { htmlUrl };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lib/github/webhook.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Implement the route handler (no unit test — thin wiring; verified manually in Task 12)**

```ts
// app/api/github/webhook/route.ts
import { extractMergedPr, verifyGithubSignature } from "@/lib/github/webhook";
import { createFlag } from "@/lib/pipeline/steps";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as unknown;
  const merged = extractMergedPr(payload);
  if (!merged) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const admin = createAdminSupabase();
  const { data: variant, error } = await admin
    .from("variants")
    .select("experiment_id, org_id")
    .eq("pr_url", merged.htmlUrl)
    .maybeSingle();

  if (error || !variant) {
    return NextResponse.json({ ok: true, matched: false });
  }

  const result = await createFlag(
    variant.org_id as string,
    variant.experiment_id as string,
  );
  return NextResponse.json({ ok: result.ok, message: result.message });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck 2>&1 | grep "app/api/github"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/github/webhook.ts lib/github/webhook.test.ts app/api/github/webhook/route.ts
git commit -m "feat: add GitHub merge webhook endpoint"
```

---

## Task 9: One-time data fix — backfill `github_repo_full_name`

**Files:** none (a single data write against the already-running Supabase project; no code in this repo changes).

This is a one-off fix for the one real org we're testing against — `org_id = 0b086141-730c-41de-bee3-cc85ea21043f` — whose `connections` row has a real `github_installation_id` but a null `github_repo_full_name` (the onboarding flow never backfills that column; see spec §3). Confirmed live during design that this installation covers `denizsaether/Student_App`.

- [ ] **Step 1: Apply the fix**

Run (uses `SUPABASE_SERVICE_ROLE_KEY` already in `.env`; make sure you're on Node 22 per `.nvmrc`):

```bash
node --env-file=.env -e "
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(url + '/rest/v1/connections?org_id=eq.0b086141-730c-41de-bee3-cc85ea21043f', {
  method: 'PATCH',
  headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ github_repo_full_name: 'denizsaether/Student_App' }),
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
"
```

- [ ] **Step 2: Verify**

```bash
node --env-file=.env -e "
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(url + '/rest/v1/connections?org_id=eq.0b086141-730c-41de-bee3-cc85ea21043f&select=org_id,github_repo_full_name', {
  headers: { apikey: key, Authorization: 'Bearer ' + key },
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
"
```

Expected: `github_repo_full_name` is `"denizsaether/Student_App"` for that row.

No commit — nothing in the repository changed.

---

## Task 10: Orchestration — wire the chat's server actions

**Files:**
- Modify: `app/actions/experiment.ts`

**Interfaces:**
- Consumes: `parseRequest`, `generateDiff`, `openPr`, `createFlag` from `@/lib/pipeline/steps` (Task 7); `StepResult` from `@/lib/pipeline/types`.
- Produces:
  - `startExperiment(formData: FormData): Promise<{ error: string } | { ok: true; experimentId: string; timeline: StepResult[] }>` (extended — same name, same first return shape on validation failure, new second shape on success)
  - `createFlagForExperiment(experimentId: string): Promise<{ error: string } | { ok: true; result: StepResult }>` (new)

No unit test: this orchestrates real Supabase writes and calls the Task 7 functions (which themselves hit Anthropic/PostHog) — verified manually in Task 12, consistent with the rest of `app/actions/*.ts` in this codebase, none of which have tests today.

- [ ] **Step 1: Replace `app/actions/experiment.ts`**

```ts
"use server";

import { getOrgId } from "@/lib/org";
import { createFlag, generateDiff, openPr, parseRequest } from "@/lib/pipeline/steps";
import type { StepResult } from "@/lib/pipeline/types";
import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireOrg() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Not signed in");
  }
  const orgId = await getOrgId(supabase, data.user);
  return { supabase, orgId };
}

export async function startExperiment(
  formData: FormData,
): Promise<{ error: string } | { ok: true; experimentId: string; timeline: StepResult[] }> {
  const prompt = String(formData.get("prompt") ?? "").trim();
  const imageCount = Number(formData.get("image_count") ?? 0);

  if (!prompt) {
    return { error: "Say what you want to try." };
  }

  const supabase = await createServerSupabase();
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    return { error: "Not signed in" };
  }

  const name = prompt.length > 72 ? `${prompt.slice(0, 69).trimEnd()}…` : prompt;
  const orgId = await getOrgId(supabase, data.user);

  const { data: experiment, error } = await supabase
    .from("experiments")
    .insert({
      org_id: orgId,
      name,
      prompt_text: prompt,
      status: "parsing",
      cycle_number: 1,
      image_paths: imageCount > 0 ? [`${imageCount} attached`] : [],
    })
    .select("id, cycle_number")
    .single();

  if (error || !experiment) {
    return { error: error?.message ?? "Could not start experiment" };
  }

  const timeline: StepResult[] = [];

  const parseResult = await parseRequest(orgId, prompt);
  timeline.push(parseResult);
  if (!parseResult.ok || !parseResult.data) {
    await supabase.from("experiments").update({ status: "error" }).eq("id", experiment.id);
    revalidatePath("/");
    return { ok: true, experimentId: experiment.id as string, timeline };
  }

  const diffResult = await generateDiff(orgId, parseResult.data);
  timeline.push(diffResult);
  if (!diffResult.ok || !diffResult.data) {
    await supabase.from("experiments").update({ status: "error" }).eq("id", experiment.id);
    revalidatePath("/");
    return { ok: true, experimentId: experiment.id as string, timeline };
  }

  const prResult = await openPr(
    orgId,
    { id: experiment.id as string, cycleNumber: experiment.cycle_number as number },
    parseResult.data,
    diffResult.data,
  );
  timeline.push(prResult);
  if (!prResult.ok) {
    await supabase.from("experiments").update({ status: "error" }).eq("id", experiment.id);
  }

  revalidatePath("/");
  return { ok: true, experimentId: experiment.id as string, timeline };
}

export async function createFlagForExperiment(
  experimentId: string,
): Promise<{ error: string } | { ok: true; result: StepResult }> {
  try {
    const { orgId } = await requireOrg();
    const result = await createFlag(orgId, experimentId);
    revalidatePath("/");
    return { ok: true, result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Not signed in" };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep "app/actions/experiment"`
Expected: no output. (`components/experiment-chat.tsx` will still error until Task 11 — that's expected at this point.)

- [ ] **Step 3: Commit**

```bash
git add app/actions/experiment.ts
git commit -m "feat: run the pipeline chain synchronously from startExperiment"
```

---

## Task 11: Chat UI — ChatGPT/Claude-style transcript

**Files:**
- Modify: `components/experiment-chat.tsx` (full rewrite)

**Interfaces:**
- Consumes: `startExperiment`, `createFlagForExperiment` from `@/app/actions/experiment` (Task 10); `STEP_META` from `@/lib/pipeline/step-meta` (Task 6); `PipelineStepName`, `StepResult` from `@/lib/pipeline/types`; `cn` from `@/lib/utils`.

- [ ] **Step 1: Replace `components/experiment-chat.tsx`**

```tsx
"use client";

import { createFlagForExperiment, startExperiment } from "@/app/actions/experiment";
import { STEP_META } from "@/lib/pipeline/step-meta";
import type { PipelineStepName, StepResult } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";
import { Check, Flag, ImagePlus, Loader2, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type UserTurn = {
  kind: "user";
  id: string;
  text: string;
  images: string[];
};

type StepCard = {
  step: PipelineStepName;
  status: "revealing" | "done" | "error";
  message: string;
};

type RunTurn = {
  kind: "run";
  id: string;
  experimentId: string;
  steps: StepCard[];
  canCreateFlag: boolean;
  flagState: "idle" | "pending" | "done" | "error";
  flagMessage: string | null;
};

type Turn = UserTurn | RunTurn;

const REVEAL_DELAY_MS = 380;

export function ExperimentChat() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 6);
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
    setPreviews((current) => current.filter((_, i) => i !== index));
  }

  function revealSteps(runId: string, timeline: StepResult[]) {
    timeline.forEach((entry, index) => {
      setTimeout(() => {
        setTurns((current) =>
          current.map((turn) => {
            if (turn.kind !== "run" || turn.id !== runId) return turn;
            const steps = [...turn.steps];
            steps[index] = {
              step: entry.step,
              status: entry.ok ? "done" : "error",
              message: entry.message,
            };
            const isLast = index === timeline.length - 1;
            return {
              ...turn,
              steps,
              canCreateFlag: isLast && entry.step === "open_pr" && entry.ok,
            };
          }),
        );
      }, index * REVEAL_DELAY_MS);
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || pending) return;

    setError(null);
    setPending(true);

    const userTurn: UserTurn = {
      kind: "user",
      id: crypto.randomUUID(),
      text: prompt,
      images: previews,
    };
    setTurns((current) => [...current, userTurn]);
    setDraft("");
    setFiles([]);
    setPreviews([]);

    const formData = new FormData();
    formData.set("prompt", prompt);
    formData.set("image_count", String(files.length));
    const result = await startExperiment(formData);

    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    const runId = crypto.randomUUID();
    const runTurn: RunTurn = {
      kind: "run",
      id: runId,
      experimentId: result.experimentId,
      steps: result.timeline.map((entry) => ({
        step: entry.step,
        status: "revealing",
        message: "",
      })),
      canCreateFlag: false,
      flagState: "idle",
      flagMessage: null,
    };
    setTurns((current) => [...current, runTurn]);
    revealSteps(runId, result.timeline);
    setPending(false);
    router.refresh();
  }

  async function onCreateFlag(runId: string, experimentId: string) {
    setTurns((current) =>
      current.map((turn) =>
        turn.kind === "run" && turn.id === runId
          ? { ...turn, flagState: "pending", flagMessage: null }
          : turn,
      ),
    );
    const result = await createFlagForExperiment(experimentId);
    setTurns((current) =>
      current.map((turn) => {
        if (turn.kind !== "run" || turn.id !== runId) return turn;
        if ("error" in result) {
          return { ...turn, flagState: "error", flagMessage: result.error };
        }
        return {
          ...turn,
          flagState: result.result.ok ? "done" : "error",
          flagMessage: result.result.message,
        };
      }),
    );
    router.refresh();
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex flex-1 flex-col gap-6 pb-6">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col justify-end gap-3">
            <p className="m-0 font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
              Studio
            </p>
            <h2 className="m-0 font-display text-3xl font-extrabold tracking-tight">
              What should we try?
            </h2>
            <p className="m-0 max-w-xl text-lg leading-relaxed">
              Describe a change in plain language. Attach screenshots of the
              current UI if the layout matters.
            </p>
          </div>
        ) : (
          turns.map((turn) =>
            turn.kind === "user" ? (
              <div key={turn.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-ink px-4 py-3 text-ticket">
                  <p className="m-0 leading-relaxed">{turn.text}</p>
                  {turn.images.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {turn.images.map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={src}
                          src={src}
                          alt=""
                          className="h-16 w-16 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div key={turn.id} className="flex flex-col gap-2">
                {turn.steps.map((card, index) => (
                  <StepCardView key={`${turn.id}-${card.step}-${index}`} card={card} />
                ))}
                {turn.canCreateFlag ? (
                  <FlagAction
                    state={turn.flagState}
                    message={turn.flagMessage}
                    onCreate={() => onCreateFlag(turn.id, turn.experimentId)}
                  />
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 bg-ledger pt-4">
        {previews.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {previews.map((src, index) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-14 w-14 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-ticket"
                  aria-label="Remove image"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="mb-2 font-mono text-xs text-[#C23A2B]">{error}</p>
        ) : null}
        <div className="flex items-end gap-2 rounded-3xl border border-rule bg-ticket px-3 py-2 shadow-stamp">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => addFiles(event.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-10 shrink-0 place-items-center rounded-full text-mute transition hover:text-ink"
            aria-label="Attach images"
          >
            <ImagePlus className="size-4" strokeWidth={1.75} />
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            placeholder="I want to try a different CTA copy on the signup screen…"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 outline-none"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-ticket transition disabled:opacity-40"
            aria-label="Send"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Send className="size-4" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function StepCardView({ card }: { card: StepCard }) {
  const meta = STEP_META[card.step];
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rule/40 bg-ticket/60 px-4 py-3">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full border",
          card.status === "error"
            ? "border-[#C23A2B] text-[#C23A2B]"
            : card.status === "done"
              ? "border-ink bg-ink text-ticket"
              : "border-rule text-mute",
        )}
      >
        {card.status === "revealing" ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
        ) : card.status === "done" ? (
          <Check className="size-3.5" strokeWidth={2.5} />
        ) : (
          <X className="size-3.5" strokeWidth={2.5} />
        )}
      </span>
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.1em] text-mute uppercase">
          <Icon className="size-3" strokeWidth={1.75} />
          {meta.label}
        </p>
        <p className="mt-1 mb-0 text-sm leading-relaxed">
          {card.status === "revealing" ? "Working…" : card.message}
        </p>
      </div>
    </div>
  );
}

function FlagAction({
  state,
  message,
  onCreate,
}: {
  state: RunTurn["flagState"];
  message: string | null;
  onCreate: () => void;
}) {
  if (state === "done") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-rule/40 bg-ticket/60 px-4 py-3 text-sm">
        <Flag className="size-4" strokeWidth={1.75} />
        {message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onCreate}
        disabled={state === "pending"}
        className="inline-flex w-fit items-center gap-2 rounded-full bg-ink px-4 py-2.5 font-display text-sm font-bold text-ticket shadow-cta transition hover:shadow-cta-hover disabled:opacity-50"
      >
        {state === "pending" ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Flag className="size-4" strokeWidth={1.75} />
        )}
        Create flag now
      </button>
      {state === "error" && message ? (
        <p className="m-0 font-mono text-xs text-[#C23A2B]">{message}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors anywhere in the project — this is the first point where the whole tree should be clean again.

- [ ] **Step 3: Visual check in the browser**

Run `pnpm dev`, sign in, go to the page that renders `<ExperimentChat />` (the dashboard/studio route), and confirm:
- The empty state and composer render with the new rounded-pill styling.
- Typing and pressing Enter (without Shift) submits.
- Attaching an image shows a removable thumbnail above the composer.

(Submitting a real prompt end-to-end is Task 12.)

- [ ] **Step 4: Commit**

```bash
git add components/experiment-chat.tsx
git commit -m "feat: restyle chat to a ChatGPT/Claude-style transcript with step cards"
```

---

## Task 12: End-to-end verification

**Files:** none — this task only runs and observes the app.

- [ ] **Step 1: Confirm environment**

```bash
node --version   # should print v22.x, matching .nvmrc
```

If it doesn't, switch (e.g. `nvm use`) before continuing.

- [ ] **Step 2: Run the full test suite, typecheck, and lint**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 3: Start the dev server and sign in**

```bash
pnpm dev
```

Sign in as the user whose org is `0b086141-730c-41de-bee3-cc85ea21043f` (the one with the real GitHub installation and PostHog connection) — confirm the dashboard shows repo `denizsaether/Student_App` and PostHog project `272715`, EU.

- [ ] **Step 4: Send a real prompt**

In the chat, send: `Make the signup CTA say "Kom i gang".`

(Note: the parser only extracts one `{element, dimension, value}` triple per prompt. To test the color dimension, send a separate prompt that only asks for a color change, e.g. `Make the signup button green.`)

Confirm, in order, with the staggered reveal:
- "Parse request" card resolves with a message like `Parsed as cta_button/copy → "Kom i gang"`.
- "Generate diff" card resolves mentioning `frontend/src/AuthPanel.tsx`.
- "Open PR" card resolves with a `https://github.com/denizsaether/Student_App/pull/<n>` link in the message.
- A "Create flag now" button appears.

- [ ] **Step 5: Confirm the `variants` rows**

```bash
node --env-file=.env -e "
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(url + '/rest/v1/variants?select=*&order=id.desc&limit=2', { headers: { apikey: key, Authorization: 'Bearer ' + key } })
  .then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
"
```

Expected: a `control` row and a `variant_b` row for the experiment just created, `variant_b.pr_url` matching the mock PR link shown in chat.

- [ ] **Step 6: Click "Create flag now" and confirm in PostHog**

Click the button in the chat. Expect it to resolve with a message like `Created PostHog flag growth-agent-xxxxxxxx`.

Then open PostHog (EU cloud, project 272715) → Feature Flags, and confirm a flag with that key exists with two variants, `control` and `variant_b`, each at 50% rollout.

- [ ] **Step 7: Confirm `variants.posthog_flag_key` was stamped**

```bash
node --env-file=.env -e "
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(url + '/rest/v1/variants?select=label,posthog_flag_key&order=id.desc&limit=2', { headers: { apikey: key, Authorization: 'Bearer ' + key } })
  .then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
"
```

Expected: both rows show the same non-null `posthog_flag_key`.

- [ ] **Step 8: (Optional) Exercise the webhook route with a synthetic signed request**

This doesn't require smee for a basic check — it just proves the route's signature verification and DB lookup work:

```bash
node --env-file=.env -e "
const crypto = require('crypto');
const secret = process.env.GITHUB_WEBHOOK_SECRET;
const body = JSON.stringify({ action: 'closed', pull_request: { merged: true, html_url: 'https://github.com/denizsaether/Student_App/pull/999' } });
const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
fetch('http://localhost:3000/api/github/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
  body,
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
"
```

Expected: `{ "ok": true, "matched": false }` (no real variant has that made-up PR URL — this just confirms the signature check and lookup path run without error). To see it actually trigger `createFlag`, use the real PR URL from Step 4 in place of `.../pull/999`.

No commit for this task — it's verification only, not a code change.

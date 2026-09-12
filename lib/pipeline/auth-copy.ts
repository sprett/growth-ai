import type { AuthCopyBlock, AuthCopyEntry } from "@/lib/pipeline/auth-panel-template";

export type NormalizedSpec = {
  element: string;
  dimension: string;
  variant_value: string;
};

/**
 * The parser (parseRequest) is intentionally open-ended about element/dimension
 * — it just asks Claude for "e.g. cta_button" / "copy | color | placement",
 * with no enum constraint. In practice the model returns close-but-not-exact
 * labels (observed: "signup_cta_button" instead of "cta_button"), so this
 * matches by keyword rather than exact string equality. AuthPanel.tsx only
 * actually has these four tunable fields, so anything that doesn't match a
 * known keyword (e.g. "placement") fails with a clear message rather than
 * silently doing nothing.
 */
function fieldFor(spec: Pick<NormalizedSpec, "element" | "dimension">): keyof AuthCopyEntry {
  const element = spec.element.toLowerCase();
  const dimension = spec.dimension.toLowerCase();

  const isCta = element.includes("cta") || element.includes("button");
  const isHeadline = element.includes("headline") || element.includes("title");
  const isTagline = element.includes("tagline") || element.includes("subtitle") || element.includes("description");
  const isColor = dimension.includes("color") || dimension.includes("colour");
  const isCopy = dimension.includes("copy") || dimension.includes("text") || dimension.includes("label");

  if (isCta && isColor) return "ctaColorClass";
  if (isCta && isCopy) return "ctaLabel";
  if (isHeadline && isCopy) return "headline";
  if (isTagline && isCopy) return "tagline";

  throw new Error(
    `Unsupported combination: ${spec.element}/${spec.dimension} — AuthPanel only supports ` +
      `cta_button (copy or color), headline (copy), and tagline (copy).`,
  );
}

export function normalizeHypothesis(raw: Record<string, string>): NormalizedSpec {
  const element = raw.element;
  const dimension = raw.dimension;
  const variantValue = raw.variant_value;

  if (typeof element !== "string" || element.trim().length === 0) {
    throw new Error("active_hypothesis.element is missing");
  }
  if (typeof dimension !== "string" || dimension.trim().length === 0) {
    throw new Error("active_hypothesis.dimension is missing");
  }
  if (typeof variantValue !== "string" || variantValue.trim().length === 0) {
    throw new Error("active_hypothesis.variant_value is missing");
  }

  return { element, dimension, variant_value: variantValue };
}

export function pickEntryField(entry: AuthCopyEntry, spec: Pick<NormalizedSpec, "element" | "dimension">): string {
  return entry[fieldFor(spec)];
}

export function applyExperimentSpec(base: AuthCopyBlock, spec: NormalizedSpec): AuthCopyBlock {
  const field = fieldFor(spec);
  return {
    signin: { ...base.signin },
    signup: { ...base.signup, [field]: spec.variant_value },
  };
}

export function buildPrBody(spec: NormalizedSpec, before: string): string {
  return [
    `**Experiment:** ${spec.element} / ${spec.dimension}`,
    "",
    `- Before: \`${before}\``,
    `- After: \`${spec.variant_value}\``,
    "",
    "_Opened by the growth agent. Merge to run this as a live PostHog experiment._",
  ].join("\n");
}

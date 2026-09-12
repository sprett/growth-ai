import type { AuthCopyBlock, AuthCopyEntry } from "@/lib/pipeline/auth-panel-template";

export type NormalizedSpec = {
  element: string;
  dimension: string;
  variant_value: string;
};

/**
 * The parser (parseRequest) is intentionally open-ended about element/dimension
 * — it just asks Claude for "e.g. cta_button" / "copy | color | placement".
 * AuthPanel.tsx only actually has these four tunable fields, so anything else
 * (e.g. "placement") fails here with a clear message rather than silently
 * doing nothing.
 */
function fieldFor(spec: Pick<NormalizedSpec, "element" | "dimension">): keyof AuthCopyEntry {
  if (spec.element === "cta_button" && spec.dimension === "copy") return "ctaLabel";
  if (spec.element === "cta_button" && spec.dimension === "color") return "ctaColorClass";
  if (spec.element === "headline" && spec.dimension === "copy") return "headline";
  if (spec.element === "tagline" && spec.dimension === "copy") return "tagline";
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

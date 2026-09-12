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

/** True when the spec maps onto the AuthPanel snapshot (CTA / headline / tagline). */
export function isAuthPanelSpec(spec: Pick<NormalizedSpec, "element" | "dimension">): boolean {
  try {
    fieldFor(spec);
    return true;
  } catch {
    return false;
  }
}

const AUTH_SCREEN_HINTS = [
  "authpanel",
  "auth panel",
  "auth_panel",
  "signin",
  "sign_in",
  "sign-in",
  "sign in",
  "signup",
  "sign_up",
  "sign-up",
  "sign up",
  "login",
  "log in",
  "logg inn",
  "opprett konto",
];

const OTHER_SCREEN_HINTS = [
  "log hours",
  "loghours",
  "logg timer",
  "logg økt",
  "logg studie",
  "dashboard",
  "subjects",
  "session timer",
  "session_timer",
  "fag-siden",
];

export function mentionsAuthScreen(text: string): boolean {
  const hay = text.toLowerCase();
  return AUTH_SCREEN_HINTS.some((hint) => hay.includes(hint));
}

export function mentionsOtherScreen(text: string): boolean {
  const hay = text.toLowerCase();
  return OTHER_SCREEN_HINTS.some((hint) => hay.includes(hint));
}

/**
 * AuthPanel has a CTA/headline/tagline, but so do dashboard and log-hours.
 * Only rewrite the AuthPanel snapshot when the request is actually about
 * sign-in / sign-up — otherwise generateDiff must look at the live repo.
 *
 * Naming another screen (log hours, dashboard, …) always wins, even if the
 * prompt also says "don't touch AuthPanel/signup" — those words used to
 * false-trigger the AuthPanel shortcut.
 */
export function shouldUseAuthPanelTemplate(
  spec: Pick<NormalizedSpec, "element" | "dimension">,
  promptText: string,
): boolean {
  if (!isAuthPanelSpec(spec)) return false;
  if (mentionsOtherScreen(promptText)) return false;
  return mentionsAuthScreen(promptText) || mentionsAuthScreen(spec.element);
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

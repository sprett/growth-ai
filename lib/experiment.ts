/**
 * Isolated experiment surface.
 *
 * The growth agent should patch THIS file (and only this file) when generating
 * a variant. Keep values as named constants so diffs stay small and apply cleanly.
 */

export type CtaPlacement = "header" | "sidebar";

export const HEADLINE = "The counter book that never loses a ticket.";

export const CTA_COPY = "Join the waitlist";

export const CTA_COLOR = "#C23A2B";

/** Control for the demo prompt: "try the CTA in the header instead of the sidebar." */
export const CTA_PLACEMENT: CtaPlacement = "sidebar";

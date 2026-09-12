import { describe, expect, it } from "vitest";
import { AUTH_COPY_DEFAULT } from "@/lib/pipeline/auth-panel-template";
import { applyExperimentSpec, buildPrBody, normalizeHypothesis, pickEntryField } from "@/lib/pipeline/auth-copy";

describe("normalizeHypothesis", () => {
  it("accepts a well-formed hypothesis", () => {
    expect(normalizeHypothesis({ element: "cta_button", dimension: "copy", variant_value: "Kom i gang" })).toEqual({
      element: "cta_button",
      dimension: "copy",
      variant_value: "Kom i gang",
    });
  });

  it("rejects a missing variant_value", () => {
    expect(() => normalizeHypothesis({ element: "cta_button", dimension: "copy", variant_value: "" })).toThrow();
  });
});

describe("applyExperimentSpec / pickEntryField", () => {
  it("matches cta_button/copy exactly", () => {
    const spec = { element: "cta_button", dimension: "copy", variant_value: "Kom i gang" };
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, spec);
    expect(next.signup.ctaLabel).toBe("Kom i gang");
    expect(next.signin).toEqual(AUTH_COPY_DEFAULT.signin);
  });

  it("matches a near-miss element name Claude actually returned in testing (signup_cta_button)", () => {
    const spec = { element: "signup_cta_button", dimension: "copy", variant_value: "Kom i gang" };
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, spec);
    expect(next.signup.ctaLabel).toBe("Kom i gang");
  });

  it("matches cta_button/color", () => {
    const spec = { element: "cta_button", dimension: "color", variant_value: "bg-emerald-600 hover:bg-emerald-700" };
    const next = applyExperimentSpec(AUTH_COPY_DEFAULT, spec);
    expect(next.signup.ctaColorClass).toBe("bg-emerald-600 hover:bg-emerald-700");
  });

  it("matches headline/copy and tagline/copy", () => {
    const headline = applyExperimentSpec(AUTH_COPY_DEFAULT, { element: "headline", dimension: "copy", variant_value: "Bli med" });
    expect(headline.signup.headline).toBe("Bli med");

    const tagline = applyExperimentSpec(AUTH_COPY_DEFAULT, {
      element: "tagline",
      dimension: "copy",
      variant_value: "Kom i gang på ti sekunder.",
    });
    expect(tagline.signup.tagline).toBe("Kom i gang på ti sekunder.");
  });

  it("throws on an unsupported combination", () => {
    expect(() =>
      applyExperimentSpec(AUTH_COPY_DEFAULT, { element: "footer", dimension: "placement", variant_value: "x" }),
    ).toThrow(/Unsupported combination/);
  });

  it("pickEntryField reads the same field applyExperimentSpec would write", () => {
    const spec = { element: "cta_button", dimension: "copy", variant_value: "x" };
    expect(pickEntryField(AUTH_COPY_DEFAULT.signup, spec)).toBe(AUTH_COPY_DEFAULT.signup.ctaLabel);
  });
});

describe("buildPrBody", () => {
  it("includes the element, dimension, before, and after", () => {
    const spec = { element: "cta_button", dimension: "copy", variant_value: "Kom i gang" };
    const body = buildPrBody(spec, "Opprett konto");
    expect(body).toContain("cta_button");
    expect(body).toContain("Opprett konto");
    expect(body).toContain("Kom i gang");
  });
});

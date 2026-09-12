import { describe, expect, it } from "vitest";
import { AUTH_COPY_DEFAULT } from "@/lib/pipeline/auth-panel-template";
import {
  applyExperimentSpec,
  buildPrBody,
  isAuthPanelSpec,
  normalizeHypothesis,
  pickEntryField,
  shouldUseAuthPanelTemplate,
} from "@/lib/pipeline/auth-copy";

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

  it("throws on an unsupported AuthPanel combination", () => {
    expect(() =>
      applyExperimentSpec(AUTH_COPY_DEFAULT, { element: "footer", dimension: "placement", variant_value: "x" }),
    ).toThrow(/Unsupported combination/);
  });

  it("identifies AuthPanel specs without treating other screens as AuthPanel", () => {
    expect(isAuthPanelSpec({ element: "cta_button", dimension: "copy" })).toBe(true);
    expect(isAuthPanelSpec({ element: "session_timer", dimension: "copy" })).toBe(false);
  });

  it("only uses the AuthPanel template when the request is actually about auth", () => {
    const cta = { element: "cta_button", dimension: "copy" };
    expect(
      shouldUseAuthPanelTemplate(cta, "Change the signup CTA copy to Start free trial"),
    ).toBe(true);
    expect(shouldUseAuthPanelTemplate({ element: "signup_cta_button", dimension: "copy" }, "Kom i gang")).toBe(
      true,
    );
    expect(
      shouldUseAuthPanelTemplate(
        cta,
        "On the log hours screen, change the primary CTA from Logg økt to Start session",
      ),
    ).toBe(false);
    expect(shouldUseAuthPanelTemplate({ element: "session_timer", dimension: "copy" }, "Keep going")).toBe(
      false,
    );
  });

  it("does not treat a log-hours request as auth just because it says not to touch AuthPanel", () => {
    const prompt = `On the Logg timer / log hours screen, change the primary session CTA.

Current: the big blue button says "Logg økt".
Change that copy to "Start session".

Copy only — do not touch AuthPanel, signup, or the dashboard.`;
    expect(shouldUseAuthPanelTemplate({ element: "cta_button", dimension: "copy" }, prompt)).toBe(false);
    expect(shouldUseAuthPanelTemplate({ element: "signup_cta", dimension: "copy" }, prompt)).toBe(false);
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

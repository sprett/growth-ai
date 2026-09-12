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

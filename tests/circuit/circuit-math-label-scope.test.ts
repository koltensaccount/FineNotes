import { describe, it, expect } from "vitest";
import {
  formatSvgTextFallback,
  renderLatexLabelToSvg,
  isLatexMath,
  stripMathDelimiters,
} from "../../src/circuit/math-label";

describe("Mathematical SVG label escaping, glyph scoping, and PDF compatibility", () => {
  it("safely escapes XML characters without breaking <tspan> formatting", () => {
    // String containing XML special characters and LaTeX subscripts
    const unsafeText = "V_{in} < 5V & R_1 > 2\\Omega";
    const formatted = formatSvgTextFallback(unsafeText);

    // XML special characters should be safely escaped
    expect(formatted).toContain("&lt;");
    expect(formatted).toContain("&amp;");
    expect(formatted).toContain("&gt;");

    // Must NOT contain unescaped raw '<' except within <tspan> tags
    const withoutTspans = formatted.replace(/<\/?tspan[^>]*>/g, "");
    expect(withoutTspans).not.toContain("<");
    expect(withoutTspans).not.toContain(">");

    // Greek character Omega should be converted to Unicode
    expect(formatted).toContain("Ω");

    // Subscript should be properly wrapped in tspan
    expect(formatted).toContain('<tspan baseline-shift="sub" font-size="0.75em">in</tspan>');
    expect(formatted).toContain('<tspan baseline-shift="sub" font-size="0.75em">1</tspan>');
  });

  it("produces unique instance scope IDs for separate label renders to prevent ID collisions", () => {
    const label1 = renderLatexLabelToSvg("V_{GS}", 100, 100);
    const label2 = renderLatexLabelToSvg("V_{DS}", 200, 200);

    // Both should contain the rendered text or data-latex-source
    expect(label1).toContain("V");
    expect(label2).toContain("V");

    // If any scoped IDs exist, they should be distinct between instances
    const scope1Matches = label1.match(/mjx_[a-z0-9]+/g);
    const scope2Matches = label2.match(/mjx_[a-z0-9]+/g);
    if (scope1Matches && scope2Matches) {
      expect(scope1Matches[0]).not.toBe(scope2Matches[0]);
    }
  });

  it("handles plain text and math mode correctly", () => {
    expect(isLatexMath("10k")).toBe(false);
    expect(isLatexMath("R_1")).toBe(true);
    expect(isLatexMath("$V_{out}$")).toBe(true);
    expect(isLatexMath("\\omega")).toBe(true);

    expect(stripMathDelimiters("$V_{in}$")).toBe("V_{in}");
    expect(stripMathDelimiters("R_1")).toBe("R_1");

    const plainSvg = renderLatexLabelToSvg("10k", 50, 50);
    expect(plainSvg).toContain("<text");
    expect(plainSvg).toContain("10k");
  });
});

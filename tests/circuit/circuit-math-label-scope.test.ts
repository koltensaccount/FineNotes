import { describe, it, expect } from "vitest";
import {
  formatSvgTextFallback,
  renderLatexLabelToSvg,
  isLatexMath,
  stripMathDelimiters,
  scopeMathJaxGlyphs,
} from "../../src/circuit/math-label";

function validateSvgMarkup(svgString: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Check for duplicate attributes on any XML tag
  const tagRegex = /<([a-zA-Z0-9:_-]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*)\s*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(svgString)) !== null) {
    const [, tagName, attrString] = match;
    if (!attrString) continue;

    const seenAttrs = new Set<string>();
    const attrRegex = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = aMatch[1];
      if (seenAttrs.has(attrName)) {
        errors.push(`Duplicate attribute "${attrName}" on <${tagName}> in tag: ${match[0]}`);
      }
      seenAttrs.add(attrName);
    }
  }

  // 2. Check for unresolved ID references
  const definedIds = new Set<string>();
  const idRegex = /\bid="([^"]+)"/g;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(svgString)) !== null) {
    definedIds.add(idMatch[1]);
  }

  const hrefRegex = /(?:(?<![a-zA-Z0-9:_-])href|xlink:href)="#([^"]+)"/g;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefRegex.exec(svgString)) !== null) {
    const target = hrefMatch[1];
    if (!definedIds.has(target)) {
      errors.push(`Unresolved reference: "#${target}"`);
    }
  }

  // 3. If xlink:href is present, verify xmlns:xlink is declared
  if (svgString.includes("xlink:href") && !svgString.includes("xmlns:xlink")) {
    errors.push("Missing xmlns:xlink namespace declaration when xlink:href is used");
  }

  return { valid: errors.length === 0, errors };
}

describe("Mathematical SVG label escaping, glyph scoping, and PDF compatibility", () => {
  it("safely escapes XML characters without breaking <tspan> formatting", () => {
    const unsafeText = "V_{in} < 5V & R_1 > 2\\Omega";
    const formatted = formatSvgTextFallback(unsafeText);

    expect(formatted).toContain("&lt;");
    expect(formatted).toContain("&amp;");
    expect(formatted).toContain("&gt;");

    const withoutTspans = formatted.replace(/<\/?tspan[^>]*>/g, "");
    expect(withoutTspans).not.toContain("<");
    expect(withoutTspans).not.toContain(">");
    expect(formatted).toContain("Ω");
    expect(formatted).toContain('<tspan baseline-shift="sub" font-size="0.75em">in</tspan>');
    expect(formatted).toContain('<tspan baseline-shift="sub" font-size="0.75em">1</tspan>');
  });

  it("properly scopes realistic MathJax SVG with defs, use, id, href, and xlink:href without duplicate attributes", () => {
    // Realistic MathJax SVG containing mixed href and xlink:href referencing defs
    const realisticMathJax = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -716 1024 716">
  <defs>
    <path id="MJX-1-TEX-N-52" d="M130 622Q123..."></path>
    <path id="MJX-1-TEX-N-31" d="M213 578..."></path>
  </defs>
  <g stroke="currentColor" fill="currentColor">
    <g data-mml-node="mi">
      <use data-c="52" href="#MJX-1-TEX-N-52"></use>
    </g>
    <g data-mml-node="mn" transform="translate(750,-150)">
      <use data-c="31" xlink:href="#MJX-1-TEX-N-31"></use>
    </g>
    <g data-mml-node="mo">
      <use href="#MJX-1-TEX-N-52" xlink:href="#MJX-1-TEX-N-52" />
    </g>
  </g>
</svg>`;

    const scoped = scopeMathJaxGlyphs(realisticMathJax, "inst_001");

    // 1. All IDs must be prefixed with the scope ID
    expect(scoped).toContain('id="inst_001_MJX-1-TEX-N-52"');
    expect(scoped).toContain('id="inst_001_MJX-1-TEX-N-31"');
    expect(scoped).not.toContain('id="MJX-1-TEX-N-52"');

    // 2. All references must point to the scoped ID
    expect(scoped).toContain('href="#inst_001_MJX-1-TEX-N-52"');
    expect(scoped).toContain('xlink:href="#inst_001_MJX-1-TEX-N-52"');
    expect(scoped).toContain('href="#inst_001_MJX-1-TEX-N-31"');
    expect(scoped).toContain('xlink:href="#inst_001_MJX-1-TEX-N-31"');

    // 3. Both href and xlink:href must be present on every use element for PDF compatibility
    const useElements = scoped.match(/<use\b[^>]*>/g) || [];
    expect(useElements.length).toBe(3);
    for (const useTag of useElements) {
      expect(useTag).toContain("href=");
      expect(useTag).toContain("xlink:href=");

      // Crucial: href must NOT match inside xlink:href or create duplicate attributes!
      const bareHrefMatches = useTag.match(/(?<![a-zA-Z0-9:_-])href=/g) || [];
      const xlinkHrefMatches = useTag.match(/xlink:href=/g) || [];
      expect(bareHrefMatches.length).toBe(1);
      expect(xlinkHrefMatches.length).toBe(1);
    }

    // 4. XML validation check
    const validation = validateSvgMarkup(scoped);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("ensures distinct IDs and valid references when multiple mathematical labels appear in the same circuit", () => {
    // Two components both using glyph "MJX-TEX-V"
    const labelSvgA = `<defs><path id="MJX-TEX-V" d="M10" /></defs><g><use href="#MJX-TEX-V" /></g>`;
    const labelSvgB = `<defs><path id="MJX-TEX-V" d="M10" /></defs><g><use xlink:href="#MJX-TEX-V" /></g>`;

    const scopedA = scopeMathJaxGlyphs(labelSvgA, "scope_A");
    const scopedB = scopeMathJaxGlyphs(labelSvgB, "scope_B");

    // Scoped IDs must be distinct
    expect(scopedA).toContain('id="scope_A_MJX-TEX-V"');
    expect(scopedB).toContain('id="scope_B_MJX-TEX-V"');
    expect(scopedA).not.toContain("scope_B");
    expect(scopedB).not.toContain("scope_A");

    // Combined diagram SVG containing both labels
    const combinedDiagram = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  ${scopedA}
  ${scopedB}
</svg>`;

    const validation = validateSvgMarkup(combinedDiagram);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // No duplicate IDs across the entire diagram
    const idMatches = combinedDiagram.match(/\bid="([^"]+)"/g) || [];
    const uniqueIds = new Set(idMatches);
    expect(idMatches.length).toBe(uniqueIds.size);
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

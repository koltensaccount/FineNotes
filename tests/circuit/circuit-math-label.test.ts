import { circuitToTikz } from "../../src/circuit/ir2tikz";
import { editorFixture } from "./editor-fixture";
import { describe, expect, it } from "vitest";
import {
  formatSvgTextFallback,
  isLatexMath,
  renderLatexLabelToSvg,
} from "../../src/circuit/math-label";

describe("Circuit LaTeX Math Labels", () => {
  it("detects LaTeX expressions correctly", () => {
    expect(isLatexMath("R_1")).toBe(true);
    expect(isLatexMath("V_{in}")).toBe(true);
    expect(isLatexMath("V_{out}")).toBe(true);
    expect(isLatexMath("I_D")).toBe(true);
    expect(isLatexMath("V_{GS}")).toBe(true);
    expect(isLatexMath("V_{DS}")).toBe(true);
    expect(isLatexMath("\\omega")).toBe(true);
    expect(isLatexMath("\\frac{V_o}{V_i}")).toBe(true);
    expect(isLatexMath("$R_1$")).toBe(true);
    expect(isLatexMath("10k")).toBe(false);
    expect(isLatexMath("Resistor")).toBe(false);
  });

  it("formats Greek symbols and subscripts in SVG tspan fallback", () => {
    const formattedOmega = formatSvgTextFallback("\\omega_0");
    expect(formattedOmega).toContain("ω");
    expect(formattedOmega).toContain('<tspan baseline-shift="sub"');
    expect(formattedOmega).toContain("0</tspan>");

    const formattedVin = formatSvgTextFallback("V_{in}");
    expect(formattedVin).toContain("V");
    expect(formattedVin).toContain('<tspan baseline-shift="sub"');
    expect(formattedVin).toContain("in</tspan>");

    const formattedFrac = formatSvgTextFallback("\\frac{V_o}{V_i}");
    expect(formattedFrac).toContain("/");
  });

  it("renders vector-compatible SVG elements with proper coordinates", () => {
    const svgR1 = renderLatexLabelToSvg("R_1", 100, 200, { color: "#0f172a" });
    expect(svgR1).toContain("100");
    expect(svgR1).toContain("200");
    expect(svgR1).toContain("#0f172a");

    const svgPlain = renderLatexLabelToSvg("10k", 50, 75, { color: "#334155" });
    expect(svgPlain).toContain('x="50"');
    expect(svgPlain).toContain('y="75"');
    expect(svgPlain).toContain("10k");
  });
});

it("renders upright SI units and spacing without leaking LaTeX commands", () => {
  const text = formatSvgTextFallback("10\\,\\mathrm{k}\\Omega");
  expect(text).toBe("10 kΩ");
  expect(formatSvgTextFallback("100\\,\\mathrm{nF}")).toBe("100 nF");
  expect(formatSvgTextFallback("5\\,\\mathrm{mV}")).not.toBe(formatSvgTextFallback("5\\,\\mathrm{MV}"));
});

it("exports inline LaTeX labels and values with exactly one math wrapper", () => {
  const c = editorFixture();
  c.components.r.label = "$R_1$";
  c.components.r.value = "$10\\,\\mathrm{k}\\Omega$";
  const code = circuitToTikz(c);
  expect(code).toContain("l=$R_1$");
  expect(code).toContain("v=$10\\,\\mathrm{k}\\Omega$");
  expect(code).not.toContain("$$");
});

it("renders infinity and common electrical notation without partial command matches", () => {
  expect(formatSvgTextFallback("R_{in} = \\infty")).toContain("∞");
  expect(formatSvgTextFallback("\\pm 5\\% \\approx \\infty")).toContain("±");
  expect(formatSvgTextFallback("\\thetasomething")).toContain("\\thetasomething");
  expect(renderLatexLabelToSvg("\\infty", 0, 0)).toContain("∞");
});

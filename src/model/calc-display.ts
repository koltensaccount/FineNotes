/**
 * Natural display math boxes tree used by LaTeX equations and math layout.
 */

export type MathBox =
  | { t: "row"; items: MathBox[] }
  /** `bold` only from typed LaTeX (`\mathbf`); the calculator never sets it. */
  | { t: "text"; s: string; role: "num" | "op" | "fn" | "var"; bold?: true }
  /** An operand not typed yet; `active` while the cursor is on it. */
  | { t: "slot"; active?: true; index?: number }
  /** Where the next key types. */
  | { t: "caret" }
  /** `bar: false`: no line between them (a binomial coefficient). */
  | { t: "frac"; num: MathBox; den: MathBox; bar?: false }
  | { t: "sup"; base: MathBox; exp: MathBox }
  /** A lowered index, with a raised one beside it when both are written (`x_i^2`). */
  | { t: "sub"; base: MathBox; sub: MathBox; sup?: MathBox }
  | { t: "root"; body: MathBox; index?: MathBox }
  /** Round brackets, or the ones `open` and `close` name ("" for none, as `\left.`). */
  | { t: "paren"; body: MathBox; open?: string; close?: string }
  | { t: "abs"; body: MathBox }
  /**
   * ∫ or Σ with limits above and below; `side`: the limits beside the sign
   * instead (an integral, as print sets it).
   */
  | {
      t: "bigop";
      sym: string;
      lo?: MathBox;
      hi?: MathBox;
      body: MathBox;
      tail?: string;
      side?: true;
    }
  /**
   * A grid of cells (a matrix, cases, aligned lines) between `open` and
   * `close` ("" for none). `align`: every column centred (absent), left, or
   * in right-left pairs as `aligned` sets them.
   */
  | { t: "matrix"; rows: MathBox[][]; open: string; close: string; align?: "l" | "rl" }
  /** A mark over (or, `under`, a line under) its body: \vec, \bar, \hat… */
  | { t: "accent"; body: MathBox; mark: MathAccent }
  /** Room, in ems of the size it is set at (`\,`, `\quad`; negative for `\!`). */
  | { t: "space"; em: number };

/** The marks {@link MathBox} `accent` can carry. */
export type MathAccent = "vec" | "bar" | "hat" | "tilde" | "dot" | "ddot" | "under";

export function boxText(b: MathBox): string {
  switch (b.t) {
    case "row":
      return b.items.map(boxText).join("");
    case "text":
      return b.s;
    case "slot":
      return b.active ? "■" : "□";
    case "caret":
      return "|";
    case "frac":
      return b.bar === false
        ? `[${boxText(b.num)} over ${boxText(b.den)}]`
        : `[${boxText(b.num)}/${boxText(b.den)}]`;
    case "sup":
      return `${boxText(b.base)}^{${boxText(b.exp)}}`;
    case "sub":
      return `${boxText(b.base)}_{${boxText(b.sub)}}${b.sup ? `^{${boxText(b.sup)}}` : ""}`;
    case "matrix":
      return `${b.open}${b.rows.map((cells) => cells.map(boxText).join(" & ")).join(" ; ")}${b.close}`;
    case "accent":
      return `${b.mark}{${boxText(b.body)}}`;
    case "space":
      return " ";
    case "root":
      return b.index ? `root{${boxText(b.index)}}{${boxText(b.body)}}` : `√{${boxText(b.body)}}`;
    case "paren":
      return `${b.open ?? "("}${boxText(b.body)}${b.close ?? ")"}`;
    case "abs":
      return `|${boxText(b.body)}|`;
    case "bigop": {
      const hi = b.hi ? `^{${boxText(b.hi)}}` : "";
      const lo = b.lo ? `_{${boxText(b.lo)}}` : "";
      return `${b.sym}${lo}${hi}${boxText(b.body)}${b.tail ? ` ${b.tail}` : ""}`;
    }
  }
}

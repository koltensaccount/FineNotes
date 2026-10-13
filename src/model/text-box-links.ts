/**
 * Link detection, tokenization, and label extraction for page text boxes.
 *
 * Supported formats:
 * - WikiLinks: [[Target]], [[Target#Heading]], [[Target|Display Name]]
 * - Markdown links: [Display Name](target)
 * - Web URLs: https://... and http://...
 */

export interface ParsedTextBoxLink {
  /** The exact raw text in the source, e.g. "[[My Note|Notes]]" */
  raw: string;
  /** Character index where the link begins */
  start: number;
  /** Character index where the link ends */
  end: number;
  /** The navigation destination (vault link target or external URL) */
  target: string;
  /** The visible text to present to the user */
  label: string;
  /** Whether the target represents an external web address */
  isUrl: boolean;
}

export type TextBoxToken =
  | { type: "text"; text: string }
  | { type: "link"; text: string; target: string; isUrl: boolean };

/** Check if a target string is a web URL. */
export function isWebUrl(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

/**
 * Trim trailing punctuation from a bare URL that belongs to sentence structure.
 */
function trimUrlPunctuation(url: string): { url: string; trailing: string } {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === "." || ch === "," || ch === "!" || ch === "?" || ch === ";" || ch === ":" || ch === ")") {
      end--;
    } else {
      break;
    }
  }
  return {
    url: url.slice(0, end),
    trailing: url.slice(end),
  };
}

/**
 * Parse all links in a text string in document order.
 */
export function parseTextBoxLinks(text: string): ParsedTextBoxLink[] {
  if (!text) return [];

  const links: ParsedTextBoxLink[] = [];

  // 1. Matches [[target]] or [[target|label]]
  const wikilinkRe = /\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]/g;
  // 2. Matches [label](target)
  const markdownLinkRe = /\[([^\]\r\n]+)\]\(([^)\r\n\s]+)\)/g;
  // 3. Matches bare https:// or http:// URLs
  const urlRe = /https?:\/\/[^\s<>'")]+/gi;

  interface Candidate {
    raw: string;
    start: number;
    end: number;
    target: string;
    label: string;
    isUrl: boolean;
  }

  const candidates: Candidate[] = [];

  let match: RegExpExecArray | null;
  while ((match = wikilinkRe.exec(text)) !== null) {
    const raw = match[0];
    const target = match[1].trim();
    const label = match[2] !== undefined ? match[2].trim() : target;
    candidates.push({
      raw,
      start: match.index,
      end: match.index + raw.length,
      target,
      label,
      isUrl: isWebUrl(target),
    });
  }

  while ((match = markdownLinkRe.exec(text)) !== null) {
    const raw = match[0];
    const label = match[1].trim();
    const target = match[2].trim();
    candidates.push({
      raw,
      start: match.index,
      end: match.index + raw.length,
      target,
      label,
      isUrl: isWebUrl(target),
    });
  }

  while ((match = urlRe.exec(text)) !== null) {
    const fullMatch = match[0];
    const { url } = trimUrlPunctuation(fullMatch);
    if (url.length > 0) {
      candidates.push({
        raw: url,
        start: match.index,
        end: match.index + url.length,
        target: url,
        label: url,
        isUrl: true,
      });
    }
  }

  // Sort candidates by start ascending, then length descending
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  // Filter overlapping candidates (first candidate wins)
  let lastEnd = 0;
  for (const cand of candidates) {
    if (cand.start >= lastEnd) {
      links.push(cand);
      lastEnd = cand.end;
    }
  }

  return links;
}

/**
 * Tokenize a text box string into alternating plain text and link tokens.
 */
export function tokenizeTextBoxLinks(text: string): TextBoxToken[] {
  if (!text) return [];

  const links = parseTextBoxLinks(text);
  if (links.length === 0) {
    return [{ type: "text", text }];
  }

  const tokens: TextBoxToken[] = [];
  let currentIdx = 0;

  for (const link of links) {
    if (link.start > currentIdx) {
      tokens.push({
        type: "text",
        text: text.slice(currentIdx, link.start),
      });
    }

    tokens.push({
      type: "link",
      text: link.label,
      target: link.target,
      isUrl: link.isUrl,
    });

    currentIdx = link.end;
  }

  if (currentIdx < text.length) {
    tokens.push({
      type: "text",
      text: text.slice(currentIdx),
    });
  }

  return tokens;
}

/**
 * Replace link syntax in text with user-visible link labels, useful
 * for clean export and thumbnail rendering without raw brackets.
 */
export function stripLinkSyntax(text: string): string {
  if (!text) return "";
  const tokens = tokenizeTextBoxLinks(text);
  return tokens.map((token) => token.text).join("");
}

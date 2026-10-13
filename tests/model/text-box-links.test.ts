import { describe, expect, it } from "vitest";
import {
  isWebUrl,
  parseTextBoxLinks,
  stripLinkSyntax,
  tokenizeTextBoxLinks,
} from "../../src/model/text-box-links";

describe("isWebUrl", () => {
  it("detects http and https URLs", () => {
    expect(isWebUrl("https://obsidian.md")).toBe(true);
    expect(isWebUrl("http://localhost:3000")).toBe(true);
    expect(isWebUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects non-web link targets", () => {
    expect(isWebUrl("Note")).toBe(false);
    expect(isWebUrl("Note#Heading")).toBe(false);
    expect(isWebUrl("folder/Note")).toBe(false);
    expect(isWebUrl("ftp://example.com")).toBe(false);
  });
});

describe("parseTextBoxLinks", () => {
  it("returns empty array for text with no links", () => {
    expect(parseTextBoxLinks("")).toEqual([]);
    expect(parseTextBoxLinks("Just some ordinary text with no links.")).toEqual([]);
  });

  it("parses simple WikiLinks", () => {
    const text = "See [[Physics 101]] for details.";
    const links = parseTextBoxLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: "[[Physics 101]]",
      start: 4,
      end: 19,
      target: "Physics 101",
      label: "Physics 101",
      isUrl: false,
    });
  });

  it("parses WikiLinks with aliases", () => {
    const text = "Read the [[Chapter 2: Motion|second chapter]] next.";
    const links = parseTextBoxLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: "[[Chapter 2: Motion|second chapter]]",
      start: 9,
      end: 45,
      target: "Chapter 2: Motion",
      label: "second chapter",
      isUrl: false,
    });
  });

  it("parses WikiLinks with headings and subpaths", () => {
    const text = "Reference [[Notes#Newton's Laws]] here.";
    const links = parseTextBoxLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("Notes#Newton's Laws");
    expect(links[0].label).toBe("Notes#Newton's Laws");
    expect(links[0].isUrl).toBe(false);
  });

  it("parses markdown links", () => {
    const text = "Check out [Obsidian](https://obsidian.md) today.";
    const links = parseTextBoxLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      raw: "[Obsidian](https://obsidian.md)",
      start: 10,
      end: 41,
      target: "https://obsidian.md",
      label: "Obsidian",
      isUrl: true,
    });
  });

  it("parses bare web URLs and trims sentence punctuation", () => {
    const text = "Visit https://google.com, then https://github.com/koltensaccount/FineNotes.";
    const links = parseTextBoxLinks(text);
    expect(links).toHaveLength(2);
    expect(links[0].target).toBe("https://google.com");
    expect(links[0].label).toBe("https://google.com");
    expect(links[1].target).toBe("https://github.com/koltensaccount/FineNotes");
    expect(links[1].label).toBe("https://github.com/koltensaccount/FineNotes");
  });

  it("parses multiple mixed links across lines without overlaps", () => {
    const text = "Line 1: [[Note A]]\nLine 2: [Docs](https://docs.example.com)\nLine 3: https://test.org";
    const links = parseTextBoxLinks(text);
    expect(links).toHaveLength(3);
    expect(links[0].target).toBe("Note A");
    expect(links[1].target).toBe("https://docs.example.com");
    expect(links[2].target).toBe("https://test.org");
  });
});

describe("tokenizeTextBoxLinks", () => {
  it("returns single text token when no links are present", () => {
    const tokens = tokenizeTextBoxLinks("Plain text");
    expect(tokens).toEqual([{ type: "text", text: "Plain text" }]);
  });

  it("tokenizes mixed content preserving interleaving text and labels", () => {
    const text = "Prefix [[Target|Label]] infix [Google](https://google.com) suffix";
    const tokens = tokenizeTextBoxLinks(text);
    expect(tokens).toEqual([
      { type: "text", text: "Prefix " },
      { type: "link", text: "Label", target: "Target", isUrl: false },
      { type: "text", text: " infix " },
      { type: "link", text: "Google", target: "https://google.com", isUrl: true },
      { type: "text", text: " suffix" },
    ]);
  });
});

describe("stripLinkSyntax", () => {
  it("removes brackets and produces clean readable text", () => {
    const text = "See [[Physics 101|Physics]] and [Home](https://example.com) for details.";
    expect(stripLinkSyntax(text)).toBe("See Physics and Home for details.");
  });

  it("preserves bare URLs while stripping brackets", () => {
    const text = "Read [[Report]] at https://example.com.";
    expect(stripLinkSyntax(text)).toBe("Read Report at https://example.com.");
  });
});

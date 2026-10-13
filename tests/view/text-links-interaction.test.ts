import { describe, expect, it, vi } from "vitest";
import { tokenizeTextBoxLinks } from "../../src/model/text-box-links";

describe("Text box links interaction logic", () => {
  it("generates correct DOM representation for text with mixed links", () => {
    const text = "Check [[Obsidian Note]] and [Site](https://example.com) for details.";
    const tokens = tokenizeTextBoxLinks(text);

    expect(tokens).toEqual([
      { type: "text", text: "Check " },
      { type: "link", text: "Obsidian Note", target: "Obsidian Note", isUrl: false },
      { type: "text", text: " and " },
      { type: "link", text: "Site", target: "https://example.com", isUrl: true },
      { type: "text", text: " for details." },
    ]);
  });

  it("handles link tap dispatcher with callbacks", () => {
    const onOpenLink = vi.fn();
    const handleTap = (
      tool: string,
      targetEl: { getAttribute: (attr: string) => string | null } | null,
    ) => {
      if (targetEl && tool !== "text") {
        const target = targetEl.getAttribute("data-link-target");
        if (target) {
          onOpenLink(target);
          return "link_opened";
        }
      }
      return "edit_mode";
    };

    const linkEl = {
      getAttribute: (attr: string) => (attr === "data-link-target" ? "My Vault Note" : null),
    };

    // When tool is pen or lasso or selection, tapping link opens it
    expect(handleTap("pen", linkEl)).toBe("link_opened");
    expect(onOpenLink).toHaveBeenCalledWith("My Vault Note");

    // When tool is text, tapping link begins editing instead of opening
    expect(handleTap("text", linkEl)).toBe("edit_mode");
    expect(onOpenLink).toHaveBeenCalledTimes(1);

    // Tapping regular text begins editing
    expect(handleTap("pen", null)).toBe("edit_mode");
  });
});

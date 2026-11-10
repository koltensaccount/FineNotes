import { expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { publishStagedNote, type GardenPublisher } from "../../src/view/garden-publish";

it("provides staged bytes and Markdown only to the publisher invocation", async () => {
  const file = { path: "note.md" } as TFile;
  const asset = { path: "ink.png" } as TFile;
  const other = { path: "other.png" } as TFile;
  const original = new ArrayBuffer(1);
  const sharp = new ArrayBuffer(4);
  const vault = { cachedRead: vi.fn(async () => "original"), readBinary: vi.fn(async () => original) };
  const garden = {
    app: { vault } as unknown as App,
    async publishNote(this: GardenPublisher, note: TFile) {
      expect(await this.app.vault.cachedRead(note)).toBe("staged");
      expect(await this.app.vault.readBinary(asset)).toBe(sharp);
      expect(await this.app.vault.readBinary(other)).toBe(original);
      return true;
    },
  };
  expect(await publishStagedNote(garden, file, "staged", new Map([[asset.path, sharp]]))).toBe(true);
  expect(await vault.cachedRead()).toBe("original");
  expect(await vault.readBinary()).toBe(original);
});

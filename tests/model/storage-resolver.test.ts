import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_MANAGED_ROOT,
  getManagedStorageRoot,
  isManagedStorageEnabled,
  getManagedSubdirectory,
  isManagedPath,
  resolveManagedFilePath,
  resolveBackingNotebookPath,
  ensureFolderExists,
  ensureManagedDirectory,
} from "../../src/model/storage-resolver";

describe("storage-resolver", () => {
  it("defaults managed storage root to FineNotes", () => {
    expect(getManagedStorageRoot()).toBe(DEFAULT_MANAGED_ROOT);
    expect(getManagedStorageRoot({})).toBe("FineNotes");
    expect(getManagedStorageRoot({ managedStorageRoot: "" })).toBe("FineNotes");
    expect(getManagedStorageRoot({ managedStorageRoot: "   " })).toBe("FineNotes");
    expect(getManagedStorageRoot({ managedStorageRoot: "Custom/Path/" })).toBe("Custom/Path");
  });

  it("checks if managed storage is enabled", () => {
    expect(isManagedStorageEnabled()).toBe(true);
    expect(isManagedStorageEnabled({})).toBe(true);
    expect(isManagedStorageEnabled({ useManagedStorage: true })).toBe(true);
    expect(isManagedStorageEnabled({ useManagedStorage: false })).toBe(false);
  });

  it("resolves subdirectories for all managed asset kinds", () => {
    expect(getManagedSubdirectory("handwriting")).toBe("FineNotes/Handwriting");
    expect(getManagedSubdirectory("embeds")).toBe("FineNotes/Embeds");
    expect(getManagedSubdirectory("media")).toBe("FineNotes/Media");
    expect(getManagedSubdirectory("exports")).toBe("FineNotes/Exports");

    const custom = { managedStorageRoot: "NotesVault/Ink" };
    expect(getManagedSubdirectory("handwriting", custom)).toBe("NotesVault/Ink/Handwriting");
    expect(getManagedSubdirectory("embeds", custom)).toBe("NotesVault/Ink/Embeds");
  });

  it("identifies paths inside managed storage", () => {
    expect(isManagedPath("FineNotes")).toBe(true);
    expect(isManagedPath("FineNotes/Embeds/clip-1.png")).toBe(true);
    expect(isManagedPath("FineNotes/Handwriting/Physics.notebook.md")).toBe(true);
    expect(isManagedPath("OtherFolder/file.png")).toBe(false);
    expect(isManagedPath("FineNotesExtra/file.png")).toBe(false);

    const custom = { managedStorageRoot: "VaultData" };
    expect(isManagedPath("VaultData/Media/audio.mp3", custom)).toBe(true);
    expect(isManagedPath("FineNotes/Embeds/clip-1.png", custom)).toBe(false);
  });

  it("resolves file paths for managed assets", () => {
    expect(resolveManagedFilePath("embeds", "note-clip-123.png")).toBe(
      "FineNotes/Embeds/note-clip-123.png",
    );
    expect(resolveManagedFilePath("exports", "Lecture.pdf")).toBe(
      "FineNotes/Exports/Lecture.pdf",
    );
  });

  it("resolves backing notebook path for Markdown notes", () => {
    const file = { path: "Classes/Engineering/Circuits.md", basename: "Circuits" };
    expect(resolveBackingNotebookPath(file as never)).toBe(
      "FineNotes/Handwriting/Circuits.notebook.md",
    );

    const custom = { managedStorageRoot: "Storage" };
    expect(resolveBackingNotebookPath(file as never, custom)).toBe(
      "Storage/Handwriting/Circuits.notebook.md",
    );
  });

  it("creates missing folder hierarchies safely", async () => {
    const created: string[] = [];
    const app = {
      vault: {
        getFolderByPath: (p: string) => (created.includes(p) ? { path: p } : null),
        createFolder: vi.fn(async (p: string) => {
          created.push(p);
        }),
      },
    };

    await ensureFolderExists(app as never, "FineNotes/Embeds");
    expect(app.vault.createFolder).toHaveBeenCalledWith("FineNotes");
    expect(app.vault.createFolder).toHaveBeenCalledWith("FineNotes/Embeds");
    expect(created).toEqual(["FineNotes", "FineNotes/Embeds"]);

    // Idempotent when folders already exist
    await ensureFolderExists(app as never, "FineNotes/Embeds");
    expect(app.vault.createFolder).toHaveBeenCalledTimes(2);

    // ensureManagedDirectory helper
    const dir = await ensureManagedDirectory(app as never, "media");
    expect(dir).toBe("FineNotes/Media");
    expect(app.vault.createFolder).toHaveBeenCalledWith("FineNotes/Media");
  });
});

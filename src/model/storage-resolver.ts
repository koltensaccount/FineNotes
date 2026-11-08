import type { App, TFile } from "obsidian";
import { normalizeFolder, joinVaultPath, cleanTitle, stripInkSuffix } from "./new-notebook";

export type ManagedStorageKind = "handwriting" | "embeds" | "media" | "exports";

export interface ManagedStorageConfig {
  useManagedStorage?: boolean;
  managedStorageRoot?: string;
}

export const DEFAULT_MANAGED_ROOT = "FineNotes";

export const MANAGED_SUBDIRS: Record<ManagedStorageKind, string> = {
  handwriting: "Handwriting",
  embeds: "Embeds",
  media: "Media",
  exports: "Exports",
};

/**
 * Returns the normalized root folder for FineNotes managed storage.
 * Empty or whitespace defaults to DEFAULT_MANAGED_ROOT ("FineNotes").
 */
export function getManagedStorageRoot(config?: ManagedStorageConfig): string {
  const root = cleanFolderString(config?.managedStorageRoot);
  return root || DEFAULT_MANAGED_ROOT;
}

/**
 * Returns whether managed storage routing is enabled. Defaults to true.
 */
export function isManagedStorageEnabled(config?: ManagedStorageConfig): boolean {
  return config?.useManagedStorage !== false;
}

/**
 * Returns the full vault-relative folder path for a specific kind of managed asset.
 * E.g. "FineNotes/Embeds" or "FineNotes/Handwriting".
 */
export function getManagedSubdirectory(
  kind: ManagedStorageKind,
  config?: ManagedStorageConfig,
): string {
  const root = getManagedStorageRoot(config);
  const sub = MANAGED_SUBDIRS[kind];
  return joinVaultPath(root, sub);
}

/**
 * Checks whether a given vault path falls within the managed storage hierarchy.
 */
export function isManagedPath(path: string, config?: ManagedStorageConfig): boolean {
  const root = getManagedStorageRoot(config);
  const normalized = normalizeFolder(path);
  return normalized === root || normalized.startsWith(`${root}/`);
}

/**
 * Resolves a vault-relative destination path for a new managed file.
 */
export function resolveManagedFilePath(
  kind: ManagedStorageKind,
  fileName: string,
  config?: ManagedStorageConfig,
): string {
  const dir = getManagedSubdirectory(kind, config);
  return joinVaultPath(dir, fileName);
}

/**
 * Resolves the managed backing notebook path for an ordinary Markdown note.
 * For example, "Math/Calculus.md" -> "FineNotes/Handwriting/Calculus.notebook.md".
 */
export function resolveBackingNotebookPath(
  markdownFile: TFile | { path: string; basename?: string },
  config?: ManagedStorageConfig,
): string {
  const rawBase =
    markdownFile.basename ??
    markdownFile.path.split("/").pop()?.replace(/\.md$/i, "") ??
    "Notebook";
  const title = cleanTitle(rawBase) || stripInkSuffix(rawBase) || "Notebook";
  const fileName = `${title}.notebook.md`;
  return resolveManagedFilePath("handwriting", fileName, config);
}

/**
 * Ensures a directory and its ancestors exist in the Obsidian vault.
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const normalized = normalizeFolder(folderPath);
  if (!normalized || !app?.vault) return;
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const getFolder = (app.vault as any).getFolderByPath;
    const exists = typeof getFolder === "function" ? getFolder.call(app.vault, current) : null;
    if (!exists) {
      try {
        if (typeof app.vault.createFolder === "function") {
          await app.vault.createFolder(current);
        }
      } catch (err) {
        // Handle race conditions where folder was created concurrently
        const stillExists = typeof getFolder === "function" ? getFolder.call(app.vault, current) : true;
        if (!stillExists) {
          throw err;
        }
      }
    }
  }
}

/**
 * Ensures the managed root and specific subdirectory exist in the vault.
 */
export async function ensureManagedDirectory(
  app: App,
  kind: ManagedStorageKind,
  config?: ManagedStorageConfig,
): Promise<string> {
  const dir = getManagedSubdirectory(kind, config);
  await ensureFolderExists(app, dir);
  return dir;
}

function cleanFolderString(val?: string): string {
  if (typeof val !== "string") return "";
  return normalizeFolder(val.trim());
}

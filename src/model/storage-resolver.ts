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

function cleanFolderString(folder?: string): string {
  if (!folder) return "";
  return normalizeFolder(folder.trim());
}

export function getManagedStorageRoot(config?: ManagedStorageConfig): string {
  return cleanFolderString(config?.managedStorageRoot) || DEFAULT_MANAGED_ROOT;
}

export function isManagedStorageEnabled(config?: ManagedStorageConfig): boolean {
  return config?.useManagedStorage !== false;
}

export function getManagedSubdirectory(
  kind: ManagedStorageKind,
  config?: ManagedStorageConfig,
): string {
  return joinVaultPath(getManagedStorageRoot(config), MANAGED_SUBDIRS[kind]);
}

export function resolveManagedFilePath(
  kind: ManagedStorageKind,
  fileName: string,
  config?: ManagedStorageConfig,
): string {
  return joinVaultPath(getManagedSubdirectory(kind, config), fileName);
}

export function resolveBackingNotebookPath(
  markdownFile: TFile | { path: string; basename?: string },
  config?: ManagedStorageConfig,
): string {
  const rawBase =
    markdownFile.basename ??
    markdownFile.path.split("/").pop()?.replace(/\.md$/i, "") ??
    "Notebook";
  const title = cleanTitle(rawBase) || stripInkSuffix(rawBase) || "Notebook";
  return resolveManagedFilePath("handwriting", `${title}.notebook.md`, config);
}

export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const normalized = normalizeFolder(folderPath);
  if (!normalized || !app?.vault) return;
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getFolderByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch (err) {
        if (!app.vault.getFolderByPath(current)) throw err;
      }
    }
  }
}

export async function ensureManagedDirectory(
  app: App,
  kind: ManagedStorageKind,
  config?: ManagedStorageConfig,
): Promise<string> {
  const dir = getManagedSubdirectory(kind, config);
  await ensureFolderExists(app, dir);
  return dir;
}

import { type App, type TFile, MarkdownView } from "obsidian";

/** Consult live editors before the saved link index, so deleting a block works immediately. */
export function referencedEmbedImages(app: App, source?: TFile, text?: string): Set<string> {
  const live = new Map<string, string>(source && text !== undefined ? [[source.path, text]] : []);
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (
      leaf.view instanceof MarkdownView &&
      leaf.view.file &&
      leaf.view.file !== source &&
      leaf.view.editor
    )
      live.set(leaf.view.file.path, leaf.view.editor.getValue());
  }
  const paths = new Set<string>();
  for (const [note, links] of Object.entries(app.metadataCache.resolvedLinks ?? {})) {
    if (!live.has(note)) for (const path of Object.keys(links)) paths.add(path);
  }
  for (const [note, content] of live) {
    for (const match of content.matchAll(
      /!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g,
    )) {
      const link = (match[1] ?? match[2] ?? match[3]).split("|")[0].split("#")[0];
      let decoded = link;
      try {
        decoded = decodeURIComponent(link);
      } catch {
        /* Keep literal vault paths. */
      }
      const file =
        app.metadataCache.getFirstLinkpathDest(decoded, note) ??
        app.vault?.getFileByPath?.(decoded);
      if (file) paths.add(file.path);
    }
  }
  return paths;
}

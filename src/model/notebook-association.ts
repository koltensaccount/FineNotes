/** Association decisions are independent of Obsidian's UI and filesystem. */
export interface AssociationInput {
  markdownPath: string;
  frontmatter?: Record<string, unknown>;
  stored?: Record<string, string>;
  text: string;
  notebooks: string[];
  resolveLink: (link: string) => string | null;
  imageOwner: (image: string) => Promise<string | null>;
}

function linkTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .trim()
    .replace(/^!?\[\[/, "")
    .replace(/\]\]$/, "")
    .split(/[|#]/)[0];
}

export async function resolveNotebookAssociation(input: AssociationInput): Promise<string | null> {
  const valid = (link: unknown): string | null => {
    const target = linkTarget(link);
    if (!target) return null;
    const path = input.resolveLink(target);
    return path && input.notebooks.includes(path) ? path : null;
  };
  for (const key of ["notebook", "finenotes-notebook"]) {
    const path = valid(input.frontmatter?.[key]);
    if (path) return path;
  }
  const stored = valid(input.stored?.[input.markdownPath]);
  if (stored) return stored;
  for (const match of input.text.matchAll(
    /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g,
  )) {
    const target = linkTarget(match[1] ?? match[2] ?? match[3]);
    if (!target) continue;
    const direct = valid(target);
    if (direct) return direct;
    if (/-clip-.*\.png$/i.test(target) || /-page-\d+\.png$/i.test(target)) {
      const owner = await input.imageOwner(target);
      if (owner && input.notebooks.includes(owner)) return owner;
    }
  }
  const folder = input.markdownPath.slice(0, input.markdownPath.lastIndexOf("/") + 1);
  const siblings = input.notebooks.filter(
    (path) => path.slice(0, path.lastIndexOf("/") + 1) === folder,
  );
  return siblings.length === 1 ? siblings[0] : null;
}

/** Handles both individual files and renamed folders, without discarding other pairs. */
export function renameNotebookAssociations(
  associations: Record<string, string>,
  oldPath: string,
  newPath: string,
): Record<string, string> {
  const rename = (path: string) =>
    path === oldPath
      ? newPath
      : path.startsWith(oldPath + "/")
        ? newPath + path.slice(oldPath.length)
        : path;
  return Object.fromEntries(
    Object.entries(associations).map(([note, notebook]) => [rename(note), rename(notebook)]),
  );
}

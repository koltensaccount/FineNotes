import type { App, TFile } from "obsidian";

interface GardenPublisher {
  app: App;
  publishNote(file: TFile): Promise<boolean>;
}

export function getGardenPublisher(app: App): GardenPublisher | null {
  const garden = (app as App & { plugins?: { plugins?: Record<string, Partial<GardenPublisher>> } })
    .plugins?.plugins?.digitalgarden;
  return garden?.app === app && typeof garden.publishNote === "function"
    ? (garden as GardenPublisher)
    : null;
}

export interface StagedHandwriting {
  file: TFile;
  png: ArrayBuffer;
}

/** Scope rewritten Markdown and generated attachments to this publisher invocation. */
export function publishStagedNote(
  garden: GardenPublisher,
  file: TFile,
  markdown: string,
  images: ReadonlyMap<string, StagedHandwriting>,
): Promise<boolean> {
  const original = garden.app;
  const vault = new Proxy(original.vault, {
    get(target, key) {
      if (key === "cachedRead" || key === "read") {
        return (note: TFile) =>
          note.path === file.path ? Promise.resolve(markdown) : target[key](note);
      }
      if (key === "readBinary")
        return (asset: TFile) => {
          const image = images.get(asset.path);
          return image ? Promise.resolve(image.png) : target.readBinary(asset);
        };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const metadataCache = new Proxy(original.metadataCache, {
    get(target, key) {
      if (key === "getFirstLinkpathDest") {
        return (path: string, source: string) =>
          images.get(path)?.file ?? target.getFirstLinkpathDest(path, source);
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const app = Object.create(original, {
    vault: { value: vault },
    metadataCache: { value: metadataCache },
  }) as App;
  const publisher = Object.create(garden, { app: { value: app } }) as GardenPublisher;
  return garden.publishNote.call(publisher, file);
}

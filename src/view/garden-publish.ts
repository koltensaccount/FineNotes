import type { App, TFile } from "obsidian";

export interface GardenPublisher {
  app: App;
  publishNote(file: TFile): Promise<boolean>;
}

export function getGardenPublisher(app: App): GardenPublisher | null {
  const garden = (app as App & { plugins?: { plugins?: Record<string, Partial<GardenPublisher>> } })
    .plugins?.plugins?.digitalgarden;
  return garden?.app === app && typeof garden.publishNote === "function" ? garden as GardenPublisher : null;
}

/** Scope staged text and PNGs to the vault instance passed to the Garden compiler. */
export function publishStagedNote(
  garden: GardenPublisher,
  file: TFile,
  markdown: string,
  images: ReadonlyMap<string, ArrayBuffer>,
): Promise<boolean> {
  const vault = garden.app.vault;
  const stagedVault = new Proxy(vault, {
    get(target, key) {
      if (key === "cachedRead") return (note: TFile) => note.path === file.path
        ? Promise.resolve(markdown) : vault.cachedRead(note);
      if (key === "readBinary") return (asset: TFile) => {
        const image = images.get(asset.path);
        return image ? Promise.resolve(image) : vault.readBinary(asset);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const stagedApp = Object.create(garden.app, { vault: { value: stagedVault } }) as App;
  const publisher = Object.create(garden, { app: { value: stagedApp } }) as GardenPublisher;
  return garden.publishNote.call(publisher, file);
}

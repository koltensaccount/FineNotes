/** A marker refers to the existing window-local InkClipboard, never a second selection format. */
const session = Math.random().toString(36).slice(2);
export function clipboardMarker(version: number): string {
  return `FineNotes selection:${session}:${version}`;
}
export interface ClipboardTarget {
  pageId?: string;
  at?: { x: number; y: number };
}
export interface ClipboardRead {
  file: File | null;
  text: string;
}
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Called directly inside the user's gesture, before any await. */
export function readSystemClipboard(): Promise<ClipboardRead> {
  const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clip?.read) return Promise.reject(new Error("Clipboard reading is unavailable"));
  try {
    const reading = clip.read();
    return reading.then(async (items) => {
      let file: File | null = null;
      let text = "";
      for (const item of items) {
        if (item.types.includes("text/plain"))
          text = await (await item.getType("text/plain")).text();
        const type = IMAGE_TYPES.find((mime) => item.types.includes(mime));
        if (!file && type) {
          const blob = await item.getType(type);
          file = new File(
            [blob],
            `Pasted image.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`,
            { type },
          );
        }
      }
      return { file, text };
    });
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}
export function writeSelectionMarker(version: number): void {
  try {
    navigator.clipboard?.writeText?.(clipboardMarker(version)).catch(() => undefined);
  } catch {
    /* Best effort; the existing internal clipboard remains available. */
  }
}
export function imageFileOf(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) if (IMAGE_TYPES.includes(file.type)) return file;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !IMAGE_TYPES.includes(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}
/** One user paste can arrive through an API result and a native event; only one owns it. */
export class PasteGate {
  private serial = 0;
  private claimed = false;
  begin(): number {
    this.claimed = false;
    return ++this.serial;
  }
  claim(ticket: number): boolean {
    if (ticket !== this.serial || this.claimed) return false;
    this.claimed = true;
    return true;
  }
  cancel(): void {
    this.serial++;
    this.claimed = true;
  }
}

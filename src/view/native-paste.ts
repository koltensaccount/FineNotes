import { type App, Modal } from "obsidian";
import { imageFileOf } from "./clipboard-read";

/** Native edit-menu fallback when a WebView refuses asynchronous clipboard reads. */
export class NativePasteModal extends Modal {
  constructor(
    app: App,
    private readonly pasted: (file: File) => void,
  ) {
    super(app);
  }
  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText("Paste a picture");
    this.contentEl.createEl("p", {
      text: "Clipboard access was unavailable. Tap and hold in the field below, then choose Paste from the system menu. A copied screenshot or picture will be inserted on the page.",
    });
    const field = this.contentEl.createEl("textarea", {
      attr: { "aria-label": "Paste picture here", placeholder: "Tap and hold here, then Paste" },
    });
    field.addEventListener("paste", (event) => {
      const file = imageFileOf(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      this.pasted(file);
      this.close();
    });
    field.focus();
  }
  override onClose(): void {
    this.contentEl.empty();
  }
}

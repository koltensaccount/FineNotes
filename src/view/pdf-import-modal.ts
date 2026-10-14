import { type App, FuzzySuggestModal, Modal, Notice, Setting, type TFile } from "obsidian";
import { allPages, parsePageRange } from "../export/page-range";
import { DialogKeyboard } from "./dialog-keyboard";
import { DEFAULT_SLIDE_LAYOUT, slidePlacement, type SlideLayout } from "../model/slide-layout";
import { errorMessage } from "../util/errors";

export class VaultPdfSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly pick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Find a PDF in the vault…");
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === "pdf");
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.pick(file);
  }
}

/** Choose source pages before any attachment is saved or notebook changed. */
export class PdfImportModal extends Modal {
  private range = "";
  private all = true;
  private busy = false;
  private slides = false;
  private layout = { ...DEFAULT_SLIDE_LAYOUT };
  private previewUrl: string | null = null;
  private keyboard: DialogKeyboard | null = null;

  constructor(
    app: App,
    private readonly name: string,
    private readonly total: number,
    private readonly insert: (indices: number[], layout?: SlideLayout) => Promise<boolean>,
    private readonly firstPage?: {width:number;height:number},
    private readonly previewBytes?: () => Promise<ArrayBuffer>,
    private readonly purpose: "import" | "notebook" = "import",
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.purpose === "notebook" ? "New notebook from PDF" : "Import PDF");
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-slide-import-modal");
    this.contentEl.createEl("p", {
      text: this.purpose === "notebook"
        ? `${this.name} · ${this.total} pages. Choose your notebook layout; the original PDF is preserved.`
        : `${this.name} · ${this.total} pages. Added at your confirmed position; the original PDF is preserved.`,
    });
    this.keyboard = new DialogKeyboard(this.modalEl);
    const slideControls = this.contentEl.createDiv({cls:"goodobsidian-slide-import-controls"});
    slideControls.hide();
    if (this.firstPage) {
      const layoutSetting = new Setting(this.contentEl).setName("Import layout").addDropdown(dropdown => dropdown
        .addOption("pages", "Original PDF pages")
        .addOption("slides", "Slide images + notes below")
        .onChange(value => { this.slides=value==="slides"; slideControls.toggle(this.slides); if(this.slides) void loadPreview(); }));
      slideControls.before(layoutSetting.settingEl);
    }
    const preview = slideControls.createDiv({cls:"goodobsidian-slide-import-preview"});
    const slideImage = preview.createEl("img",{attr:{alt:"First PDF slide preview"}});
    const notes = preview.createDiv({text:"Blank space for notes",cls:"goodobsidian-slide-import-notes"});
    const updatePreview = () => {
      const placed = slidePlacement(this.firstPage ?? {width:16,height:9},800,this.layout);
      preview.style.width = `min(100%, ${Math.min(350,400*placed.geometry.width/placed.geometry.height)}px)`;
      preview.style.aspectRatio = `${placed.geometry.width} / ${placed.geometry.height}`;
      slideImage.style.left=`${placed.image.x/placed.geometry.width*100}%`;
      slideImage.style.top=`${placed.image.y/placed.geometry.height*100}%`;
      slideImage.style.width=`${placed.image.w/placed.geometry.width*100}%`;
      slideImage.style.height=`${placed.image.h/placed.geometry.height*100}%`;
      notes.style.top=`${(placed.image.y+placed.image.h)/placed.geometry.height*100}%`;
    };
    let previewLoading=false;
    const loadPreview = async () => {
      if(this.previewUrl || previewLoading || !this.previewBytes) return;
      previewLoading=true;
      try {
        const bytes=await this.previewBytes();
        if(!preview.isConnected) return;
        this.previewUrl=URL.createObjectURL(new Blob([bytes],{type:"image/png"}));
        slideImage.src=this.previewUrl;
      } catch { notes.setText("Preview unavailable; import can still be attempted."); }
      finally { previewLoading=false; }
    };
    for (const [key,name,min,max] of [["widthPercent","Slide width",50,100],["notesPercent","Notes space (relative to slide height)",25,300]] as const) {
      const setting=new Setting(slideControls).setName(name);
      const value=setting.nameEl.createSpan({text:` · ${this.layout[key]}%`});
      setting.addSlider(slider=>slider.setLimits(min,max,1).setValue(this.layout[key]).setDynamicTooltip().onChange(v=>{
        this.layout[key]=v; value.setText(` · ${v}%`); updatePreview();
      }));
    }
    slideControls.createEl("p",{text:"Preview uses the first PDF page. Slides retain their aspect ratio; pages grow to leave notes space below. You can write on the slide image too."});
    updatePreview();

    new Setting(this.contentEl).setName("Pages").addDropdown((dropdown) =>
      dropdown
        .addOption("all", "All pages")
        .addOption("custom", "Selected pages")
        .onChange((value) => {
          this.all = value === "all";
          row.settingEl.toggle(!this.all);
        }),
    );
    const row = new Setting(this.contentEl)
      .setName("Page range")
      .setDesc("For example: 1-3, 5. Pages are imported in the order entered.");
    row.settingEl.toggle(false);
    row.addText((field) => {
      field.setPlaceholder("1-3, 5").onChange((value) => {
        this.range = value;
      });
      this.keyboard?.watch(field.inputEl, row.settingEl);
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText(this.purpose === "notebook" ? "Create notebook" : "Import")
          .setCta()
          .onClick(async () => {
            if (this.busy) return;
            const result = this.all
              ? { ok: true as const, pages: allPages(this.total) }
              : parsePageRange(this.range, this.total);
            if (!result.ok) {
              new Notice(result.error.replace(/export/g, "import").replace(/notebook/g, "PDF"));
              return;
            }
            this.busy = true;
            button.setDisabled(true);
            try {
              if (await this.insert(result.pages, this.slides ? {...this.layout} : undefined)) this.close();
              else if(this.purpose === "import")
                new Notice("PDF import stopped: the notebook is no longer available for editing.");
            } catch (error) {
              new Notice(`FineNotes: couldn't import PDF — ${errorMessage(error)}`, 8000);
            } finally {
              this.busy = false;
              button.setDisabled(false);
            }
          }),
      )
      .addButton((button) =>
        button
          .setClass("clickable-icon")
          .setButtonText("Cancel")
          .onClick(() => {
            if (!this.busy) this.close();
          }),
      );
  }
  override onClose(): void {
    this.keyboard?.end();
    if(this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl=null;
    this.contentEl.empty();
  }
}

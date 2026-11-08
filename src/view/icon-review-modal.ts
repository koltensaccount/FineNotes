/**
 * In-plugin, side-by-side review of every proposed FineNotes icon replacement.
 * Nothing in this gallery changes the production toolbar, notebooks or SVGs.
 * Decisions are recorded individually so approved and rejected candidates can
 * be implemented selectively after the design review.
 */
import { Modal, Notice, setIcon, type App } from "obsidian";
import { createStrokePreview, type PreviewTool } from "./stroke-preview";
import {
  ICON_FAMILY_CANDIDATES,
  candidateIconName,
  type IconFamilyCandidate,
  type IconFamilyGroup,
  type IconReviewDecision,
} from "./icon-family";

export interface IconReviewHost {
  decisions: () => Readonly<Record<string, IconReviewDecision>>;
  currentPen: () => { type: PreviewTool; width: number };
  saveDecision: (id: string, value: IconReviewDecision | null) => Promise<void>;
}

const GROUPS: readonly IconFamilyGroup[] = [
  "Handwriting and PDF updates",
  "Import and convert",
  "Notebook and pages",
  "Writing tools",
];

const INK_CHOICES = [
  { value: "#4184df", label: "Blue" },
  { value: "#d94e50", label: "Red" },
  { value: "#288a65", label: "Green" },
  { value: "#e2b32d", label: "Yellow" },
  { value: "#161616", label: "Black" },
  { value: "#ffffff", label: "White" },
] as const;

export class IconReviewModal extends Modal {
  private inkColor: string = INK_CHOICES[0].value;
  private previewTheme: "auto" | "light" | "dark" = "auto";
  private countEl: HTMLElement | null = null;
  private readonly comments = new Map<string, string>();
  private feedbackReadable = true;

  constructor(
    app: App,
    private readonly host: IconReviewHost,
    private readonly feedbackPath: string,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("finenotes-icon-review-modal");
    this.titleEl.setText("FineNotes Icon Studio — Concept #2");
    this.contentEl.setText("Loading icon feedback…");
    void this.loadFeedback();
  }

  private async loadFeedback(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(this.feedbackPath)) {
        const entries: unknown = JSON.parse(await adapter.read(this.feedbackPath));
        if (!Array.isArray(entries)) throw new Error("Expected a feedback list");
        for (const entry of entries as unknown[]) {
          if (
            entry && typeof entry === "object" &&
            "id" in entry && typeof entry.id === "string" &&
            "comment" in entry && typeof entry.comment === "string"
          ) {
            this.comments.set(entry.id, entry.comment);
          }
        }
      }
    } catch {
      this.feedbackReadable = false;
      new Notice("FineNotes: saved icon feedback could not be read. You can still copy new feedback.");
    }
    if (this.contentEl.isConnected) this.render();
  }

  private feedbackJson(): string {
    const decisions = this.host.decisions();
    return JSON.stringify(ICON_FAMILY_CANDIDATES.map(({ id, title }) => ({
      id,
      title,
      decision: decisions[id] ?? "undecided",
      comment: this.comments.get(id) ?? "",
    })), null, 2);
  }

  override onClose(): void {
    this.countEl = null;
    this.contentEl.empty();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("finenotes-icon-review");
    root.setCssProps({ "--fn-review-ink": this.inkColor });
    root.setAttribute("data-preview-theme", this.previewTheme);

    root.createDiv({
      cls: "finenotes-icon-review-intro",
      text:
        "Final batch: Handwrite Here and Update companion PDF. Compare Current and New, then approve or reject each icon. " +
        "Add comments under each icon, then choose Save feedback to keep your comments and decisions.",
    });

    const controls = root.createDiv({ cls: "finenotes-icon-review-controls" });
    const chooser = controls.createDiv({ cls: "finenotes-icon-review-swatches" });
    chooser.createSpan({ cls: "finenotes-icon-review-small-label", text: "Test ink color" });
    for (const item of INK_CHOICES) {
      const button = chooser.createEl("button", {
        cls: "finenotes-icon-review-swatch clickable-icon",
        attr: { type: "button", title: item.label, "aria-label": item.label },
      });
      button.style.backgroundColor = item.value;
      button.setAttribute("aria-pressed", String(item.value === this.inkColor));
      button.addEventListener("click", () => {
        this.inkColor = item.value;
        root.setCssProps({ "--fn-review-ink": item.value });
        for (const node of Array.from(chooser.querySelectorAll<HTMLButtonElement>("button"))) {
          node.setAttribute("aria-pressed", String(node === button));
        }
      });
    }
    const theme = controls.createDiv({ cls: "finenotes-icon-review-themes" });
    theme.createSpan({ cls: "finenotes-icon-review-small-label", text: "Preview" });
    for (const mode of ["auto", "light", "dark"] as const) {
      const button = theme.createEl("button", {
        cls: "finenotes-icon-review-theme",
        text: mode === "auto" ? "Obsidian" : mode === "light" ? "Light" : "Dark",
        attr: { type: "button", "aria-pressed": String(mode === this.previewTheme) },
      });
      button.addEventListener("click", () => {
        this.previewTheme = mode;
        root.setAttribute("data-preview-theme", mode);
        for (const node of Array.from(theme.querySelectorAll<HTMLButtonElement>("button"))) {
          node.setAttribute("aria-pressed", String(node === button));
        }
      });
    }

    const size = controls.createEl("label", { cls: "finenotes-icon-review-size" });
    size.createSpan({ text: "Preview size" });
    const slider = size.createEl("input", {
      attr: { type: "range", min: "16", max: "48", value: "25", "aria-label": "Preview size", "aria-valuetext": "25 px" },
    });
    const sizeValue = size.createSpan({ text: "25 px" });
    slider.addEventListener("input", () => {
      const value = `${slider.value} px`;
      root.setCssProps({ "--fn-review-size": `${slider.value}px` });
      sizeValue.setText(value);
      slider.setAttribute("aria-valuetext", value);
    });

    this.countEl = controls.createDiv({ cls: "finenotes-icon-review-progress" });
    this.syncProgress();

    const copy = controls.createEl("button", {
      cls: "finenotes-icon-review-copy",
      text: "Copy feedback",
      attr: { type: "button" },
    });
    copy.addEventListener("click", () => {
      if (!navigator.clipboard?.writeText) {
        new Notice("FineNotes: clipboard unavailable on this device.");
        return;
      }
      void navigator.clipboard.writeText(this.feedbackJson())
        .then(() => new Notice("FineNotes icon feedback copied."))
        .catch(() => new Notice("FineNotes: clipboard unavailable on this device."));
    });

    const save = controls.createEl("button", {
      text: "Save feedback",
      attr: { type: "button", title: "Save decisions and comments in the local FineNotes plugin folder" },
    });
    save.disabled = !this.feedbackReadable;
    save.addEventListener("click", () => {
      save.disabled = true;
      void this.app.vault.adapter.write(this.feedbackPath, this.feedbackJson())
        .then(() => new Notice("FineNotes icon feedback saved."))
        .catch(() => new Notice("FineNotes: could not save icon feedback."))
        .finally(() => { save.disabled = false; });
    });

    for (const groupName of GROUPS) {
      const group = root.createDiv({ cls: "finenotes-icon-review-group" });
      group.createEl("h3", { text: groupName });
      for (const candidate of ICON_FAMILY_CANDIDATES) {
        if (candidate.category === groupName) this.renderCandidate(group, candidate);
      }
    }
    const footer = root.createDiv({ cls: "finenotes-icon-review-footer" });
    footer.createSpan({
      text: "Preview only: approvals do not replace live icons. Actual pen and highlighter stroke previews, Lasso modes, Shape outlines, and normal Obsidian UI controls remain unchanged.",
    });
  }

  private renderCandidate(root: HTMLElement, candidate: IconFamilyCandidate): void {
    const card = root.createDiv({ cls: "finenotes-icon-review-item" });
    card.setAttribute("data-icon-id", candidate.id);
    const details = card.createDiv({ cls: "finenotes-icon-review-details" });
    details.createDiv({ cls: "finenotes-icon-review-name", text: candidate.title });
    details.createDiv({ cls: "finenotes-icon-review-location", text: candidate.usage });
    if (candidate.preserveState) {
      details.createDiv({
        cls: "finenotes-icon-review-preserve",
        text: candidate.preserveState,
      });
    }

    const comparison = card.createDiv({ cls: "finenotes-icon-review-pair" });
    const original = comparison.createDiv({ cls: "finenotes-icon-review-example" });
    original.createSpan({ cls: "finenotes-icon-review-stage-label", text: "Current" });
    const originalStage = original.createDiv({ cls: "finenotes-icon-review-stage" });
    this.renderOriginal(originalStage, candidate);
    const proposed = comparison.createDiv({ cls: "finenotes-icon-review-example" });
    proposed.createSpan({ cls: "finenotes-icon-review-stage-label", text: "New" });
    const proposedStage = proposed.createDiv({ cls: "finenotes-icon-review-stage" });
    const nextIcon = proposedStage.createSpan({ cls: "finenotes-icon-review-svg" });
    try {
      setIcon(nextIcon, candidateIconName(candidate.id));
      // Obsidian's addIcon wrapper may not use Lucide's 24-unit box by default.
      // Match the existing fork's rectangular-lasso fix for all custom candidates.
      nextIcon.querySelector("svg")?.setAttribute("viewBox", "0 0 24 24");
    } catch {
      nextIcon.setText("?");
    }
    proposedStage.setAttribute("aria-label", `Proposed ${candidate.title} icon`);

    const actions = card.createDiv({ cls: "finenotes-icon-review-actions" });
    const result = actions.createDiv({ cls: "finenotes-icon-review-result" });
    const buttons = actions.createDiv({ cls: "finenotes-icon-review-buttons" });
    const approve = buttons.createEl("button", {
      cls: "finenotes-icon-review-approve",
      text: "Approve",
      attr: { type: "button" },
    });
    const reject = buttons.createEl("button", {
      cls: "finenotes-icon-review-reject",
      text: "Reject",
      attr: { type: "button" },
    });
    const clear = actions.createEl("button", {
      cls: "finenotes-icon-review-clear",
      text: "Clear decision",
      attr: { type: "button" },
    });
    const sync = (): void => {
      const choice = this.host.decisions()[candidate.id] ?? null;
      result.setText(choice === "approved" ? "Approved" : choice === "rejected" ? "Rejected" : "Undecided");
      card.setAttribute("data-decision", choice ?? "undecided");
      approve.setAttribute("aria-pressed", String(choice === "approved"));
      reject.setAttribute("aria-pressed", String(choice === "rejected"));
      clear.toggleClass("is-hidden", choice === null);
    };
    sync();

    const commit = async (choice: IconReviewDecision | null): Promise<void> => {
      approve.disabled = reject.disabled = clear.disabled = true;
      try {
        await this.host.saveDecision(candidate.id, choice);
        sync();
        this.syncProgress();
      } catch (error) {
        new Notice(`FineNotes: could not save icon decision: ${String(error)}`);
      } finally {
        approve.disabled = reject.disabled = clear.disabled = false;
      }
    };
    const feedback = card.createDiv({ cls: "finenotes-icon-review-feedback" });
    const label = feedback.createEl("label", { text: `Comment on ${candidate.title}` });
    const comment = label.createEl("textarea", {
      attr: { rows: "2", placeholder: "What works, or what should change?" },
    });
    comment.value = this.comments.get(candidate.id) ?? "";
    comment.addEventListener("input", () => this.comments.set(candidate.id, comment.value));

    approve.addEventListener("click", () => void commit("approved"));
    reject.addEventListener("click", () => void commit("rejected"));
    clear.addEventListener("click", () => void commit(null));
  }

  private renderOriginal(stage: HTMLElement, candidate: IconFamilyCandidate): void {
    const slot = stage.createSpan({ cls: "finenotes-icon-review-svg" });
    const doc = stage.ownerDocument;
    if (candidate.original === "fn-original-none") {
      slot.setText("—");
      slot.setAttribute("aria-label", "No existing dedicated icon");
      stage.setAttribute("title", "No dedicated icon exists in the current interface");
      return;
    }
    if (candidate.original.startsWith("fn-original-")) {
      const current = this.host.currentPen();
      const type = candidate.original === "fn-original-pen"
        ? current.type
        : candidate.original === "fn-original-highlighter"
          ? "highlighter"
          : candidate.original === "fn-original-brush"
            ? "brush"
            : "ball";
      const preview = createStrokePreview({
        type,
        width: candidate.original === "fn-original-pen"
          ? current.width
          : type === "highlighter" ? 8 : type === "brush" ? 5 : 3,
        color: "currentColor",
        compact: true,
      }, doc);
      preview.setAttribute("width", "29");
      preview.setAttribute("height", "24");
      slot.append(preview);
      return;
    }
    try {
      setIcon(slot, candidate.original);
      if (candidate.original === "finenotes-rectangular-lasso") {
        slot.querySelector("svg")?.setAttribute("viewBox", "0 0 24 24");
      }
    } catch {
      slot.setText("?");
    }
  }

  private syncProgress(): void {
    if (!this.countEl) return;
    const decisions = this.host.decisions();
    let approved = 0;
    let rejected = 0;
    for (const candidate of ICON_FAMILY_CANDIDATES) {
      if (decisions[candidate.id] === "approved") approved++;
      if (decisions[candidate.id] === "rejected") rejected++;
    }
    this.countEl.setText(
      `${approved} approved · ${rejected} rejected · ${ICON_FAMILY_CANDIDATES.length - approved - rejected} undecided`,
    );
  }
}

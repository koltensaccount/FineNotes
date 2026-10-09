import { DEFAULT_WRITING_GUIDES, writingGuidesOf, guideColor, type WritingGuideStyle } from "../model/writing-guides";
import { blankPage } from "../model/document";
import { paintWritingGuides } from "../canvas/writing-guides";
import { renderColorMixer } from "./color-picker";
import { installPopoverDismiss, placePopover } from "./template-picker";

export interface WritingGuideHost {
  state: () => { enabled: boolean; style: WritingGuideStyle; eligible: boolean; paper: string; scale: number };
  enable: (enabled: boolean) => void;
  configure: (patch: Partial<WritingGuideStyle>) => void;
  subscribe: (changed: () => void) => () => void;
}

/** Shared by More's compact popover and Notebook Settings. No document edits. */
export function renderWritingGuideControls(parent: HTMLElement, host: WritingGuideHost): () => void {
  const body = parent.createDiv({ cls: "goodobsidian-writing-guides" });
  const row = body.createEl("label", { cls: "goodobsidian-guide-enable", text: "Enable writing guides" });
  const enabled = row.createEl("input", { type: "checkbox", attr: { "aria-label": "Enable writing guides" } });
  enabled.addEventListener("change", () => host.enable(enabled.checked));
  const notice = body.createDiv({ cls: "goodobsidian-popover-hint" });
  const buttons = new Map<string, HTMLButtonElement>();
  const segments = (title: string, choices: readonly string[], choose: (value: string) => void): void => {
    body.createDiv({ cls: "goodobsidian-guide-label", text: title });
    const group = body.createDiv({ cls: "goodobsidian-segmented" });
    group.setAttribute("role", "group"); group.setAttribute("aria-label", title);
    for (const choice of choices) {
      const button = group.createEl("button", { text: choice[0].toUpperCase() + choice.slice(1), cls: "clickable-icon" });
      button.addEventListener("click", () => choose(choice)); buttons.set(`${title}:${choice}`, button);
    }
  };
  segments("Style", ["lines", "grid", "dots"], value => host.configure({ style: value as WritingGuideStyle["style"] }));
  const sliders = new Map<string, { input: HTMLInputElement; value: HTMLElement }>();
  for (const [key, title, min, max, step, factor] of [
    ["spacing", "Spacing", 8, 128, 1, 1], ["thickness", "Thickness", .5, 3, .1, 1], ["opacity", "Opacity", 5, 60, 1, 100],
  ] as const) {
    const label = body.createEl("label", { cls: "goodobsidian-guide-slider" });
    const head = label.createDiv({ cls: "goodobsidian-guide-slider-head" });
    head.createSpan({ text: title }); const value = head.createSpan();
    const input = label.createEl("input", { type: "range", attr: { "aria-label": title } });
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.addEventListener("input", () => host.configure({ [key]: Number(input.value) / factor }));
    sliders.set(key, { input, value });
  }
  segments("Color", ["auto", "custom"], value => host.configure({ colorMode: value as "auto" | "custom" }));
  const swatch = body.createEl("button", { cls: "goodobsidian-guide-color clickable-icon", attr: { "aria-label": "Choose custom guide color" } });
  const disc = swatch.createSpan({ cls: "goodobsidian-guide-color-disc" }); const colorLabel = swatch.createSpan();
  const mixer = body.createDiv({ cls: "is-hidden" });
  swatch.addEventListener("click", () => {
    if (!mixer.hasClass("is-hidden")) { mixer.addClass("is-hidden"); return; }
    mixer.empty();
    renderColorMixer(mixer, host.state().style.customColor, color => { host.configure({ customColor: color, colorMode: "custom" }); mixer.addClass("is-hidden"); });
    mixer.removeClass("is-hidden");
  });
  const previewLabel = body.createDiv({ cls: "goodobsidian-popover-hint" });
  const preview = body.createEl("canvas", { cls: "goodobsidian-guide-preview", attr: { "aria-label": "Writing guide pattern at current zoom" } });
  const reset = body.createEl("button", { cls: "goodobsidian-guide-reset", text: "Reset to defaults" });
  reset.addEventListener("click", () => { host.configure({ ...DEFAULT_WRITING_GUIDES }); mixer.addClass("is-hidden"); });
  let previewKey = "";
  const refresh = (): void => {
    const state = host.state(), style = writingGuidesOf(state.style);
    enabled.checked = state.enabled;
    notice.textContent = "Temporary guides on every page. Never included in PDFs or thumbnails.";
    for (const [key, control] of sliders) {
      const number = style[key as "spacing" | "thickness" | "opacity"];
      control.input.value = String(key === "opacity" ? Math.round(number * 100) : number);
      control.value.textContent = key === "opacity" ? `${Math.round(number * 100)}%` : key === "thickness" ? `${number.toFixed(1)} CSS px` : `${number} page px`;
    }
    for (const [key, button] of buttons) { const active = key === `Style:${style.style}` || key === `Color:${style.colorMode}`; button.toggleClass("is-active", active); button.setAttribute("aria-pressed", String(active)); }
    const color = guideColor(style, state.paper);
    disc.style.backgroundColor = color; colorLabel.textContent = style.colorMode === "auto" ? "Automatic paper contrast" : style.customColor;
    swatch.disabled = style.colorMode === "auto";
    if (style.colorMode === "auto") mixer.addClass("is-hidden");
    const scale = Math.max(.01, state.scale);
    const key = JSON.stringify([style, state.paper, scale]);
    if (previewKey === key) return; previewKey = key;
    previewLabel.textContent = `Current zoom · ${(style.spacing * scale).toFixed(1)} CSS px spacing`;
    const dpr = Math.min(2, parent.ownerDocument.defaultView?.devicePixelRatio || 1);
    const width = 260, height = 72;
    preview.width = width * dpr; preview.height = height * dpr;
    const ctx = preview.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = state.paper; ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);
    const page = blankPage("guide-preview", { width: width / scale, height: height / scale });
    paintWritingGuides(ctx, page, { minX: 0, minY: 0, maxX: page.geometry.width, maxY: page.geometry.height }, style, state.paper, scale, scale * dpr);
  };
  refresh(); return host.subscribe(refresh);
}

export class WritingGuidePopover {
  private readonly el: HTMLElement;
  private readonly dispose: (() => void)[] = [];
  private closed = false;
  constructor(readonly anchorEl: HTMLElement, host: WritingGuideHost) {
    this.el = anchorEl.ownerDocument.body.createDiv({ cls: "goodobsidian-guide-popover goodobsidian-addpage is-dense-editor" });
    this.el.setAttribute("role", "dialog"); this.el.setAttribute("aria-label", "Writing guides");
    this.el.createDiv({ cls: "goodobsidian-addpage-title", text: "Writing guides" });
    this.dispose.push(renderWritingGuideControls(this.el, host));
    const place = (): void => placePopover(this.el, anchorEl, 320);
    place(); this.dispose.push(installPopoverDismiss(this.el, anchorEl, () => this.close(), place));
  }
  get isOpen(): boolean { return !this.closed; }
  close(): void { if (this.closed) return; this.closed = true; for (const dispose of this.dispose) dispose(); this.el.remove(); }
}

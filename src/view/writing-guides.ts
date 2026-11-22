/**
 * Writing Guides Frosted Glass Popover — unified with the locked Visual
 * Identity (8/12/14px radii, Frosted Glass surface, Neutral Well + WCAG
 * contrast-safe Accent Icon active states, compact centered sliders,
 * circular color swatches, zero emojis, and full Live Preview event isolation).
 */

import { setIcon } from "obsidian";
import { blankPage } from "../model/document";
import {
  DEFAULT_WRITING_GUIDES,
  guideColor,
  writingGuidesOf,
  type WritingGuideStyle,
} from "../model/writing-guides";
import { paintWritingGuides } from "../canvas/writing-guides";
import { renderColorPicker } from "./color-picker";

export interface WritingGuideHost {
  state: () => {
    enabled: boolean;
    includeInPreview?: boolean;
    style: WritingGuideStyle;
    eligible: boolean;
    paper: string;
    scale: number;
  };
  enable: (enabled: boolean) => void;
  includeInPreview?: (enabled: boolean) => void;
  configure: (patch: Partial<WritingGuideStyle>) => void;
  subscribe: (changed: () => void) => () => void;
}

export function renderWritingGuideControls(
  parent: HTMLElement,
  host: WritingGuideHost,
): () => void {
  const body = parent.createDiv({ cls: "goodobsidian-writing-guides" });

  const makeToggle = (labelText: string, onChange: (checked: boolean) => void): HTMLInputElement => {
    const row = body.createEl("label", { cls: "goodobsidian-guide-toggle" });
    row.createSpan({ text: labelText });
    const input = row.createEl("input", {
      type: "checkbox",
      attr: { "aria-label": labelText },
    });
    input.addEventListener("change", () => onChange(input.checked));
    return input;
  };

  const enabled = makeToggle("Writing guides", (v) => host.enable(v));
  const includeInPreview = host.includeInPreview
    ? makeToggle("Show in saved preview", (v) => host.includeInPreview?.(v))
    : null;

  const buttons = new Map<string, HTMLButtonElement>();
  const addSegments = (
    title: string,
    choices: ReadonlyArray<readonly [string, string]>,
    choose: (value: string) => void,
  ): void => {
    body.createDiv({ cls: "goodobsidian-guide-label", text: title });
    const group = body.createDiv({ cls: "goodobsidian-guide-segmented" });
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", title);
    for (const [id, label] of choices) {
      const btn = group.createEl("button", {
        cls: "clickable-icon goodobsidian-guide-seg-btn",
        text: label,
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        choose(id);
      });
      buttons.set(`${title}:${id}`, btn);
    }
  };

  addSegments(
    "Overlay style",
    [
      ["lines", "Lines"],
      ["grid", "Grid"],
      ["dots", "Dots"],
    ],
    (value) => host.configure({ style: value as WritingGuideStyle["style"] }),
  );

  const sliders = new Map<string, { input: HTMLInputElement; value: HTMLElement }>();
  for (const [key, title, min, max, step, factor] of [
    ["spacing", "Spacing", 8, 128, 1, 1],
    ["thickness", "Thickness", 0.5, 3, 0.1, 1],
    ["opacity", "Opacity", 5, 60, 1, 100],
  ] as const) {
    const wrap = body.createDiv({ cls: "goodobsidian-guide-slider" });
    const head = wrap.createDiv({ cls: "goodobsidian-guide-slider-head" });
    head.createSpan({ text: title });
    const val = head.createSpan({ cls: "goodobsidian-guide-slider-val" });
    const input = wrap.createEl("input", {
      type: "range",
      attr: { "aria-label": title },
    });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener("input", () => host.configure({ [key]: Number(input.value) / factor }));
    sliders.set(key, { input, value: val });
  }

  addSegments(
    "Color",
    [
      ["auto", "Auto"],
      ["custom", "Custom"],
    ],
    (value) => host.configure({ colorMode: value as "auto" | "custom" }),
  );

  const swatchBtn = body.createEl("button", {
    cls: "goodobsidian-guide-color clickable-icon",
    attr: { "aria-label": "Choose custom guide color" },
  });
  const disc = swatchBtn.createSpan({ cls: "goodobsidian-guide-color-disc" });
  const colorLabel = swatchBtn.createSpan({ cls: "goodobsidian-guide-color-label" });
  const pickerWrap = body.createDiv({ cls: "goodobsidian-guide-picker is-hidden" });

  swatchBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pickerWrap.hasClass("is-hidden")) {
      pickerWrap.addClass("is-hidden");
      return;
    }
    pickerWrap.empty();
    renderColorPicker(pickerWrap, {
      current: host.state().style.customColor,
      recent: [],
      onPick: (color) => {
        if (!color) return;
        host.configure({ customColor: color, colorMode: "custom" });
        pickerWrap.addClass("is-hidden");
      },
      onCustom: (color) => {
        host.configure({ customColor: color, colorMode: "custom" });
        pickerWrap.addClass("is-hidden");
      },
    });
    pickerWrap.removeClass("is-hidden");
  });

  const preview = body.createEl("canvas", {
    cls: "goodobsidian-guide-preview",
    attr: { "aria-label": "Writing guide preview" },
  });

  const footer = body.createDiv({ cls: "goodobsidian-guide-footer" });
  const hint = footer.createSpan({ cls: "goodobsidian-guide-hint" });
  const reset = footer.createEl("button", {
    cls: "clickable-icon goodobsidian-guide-reset",
    text: "Reset",
  });
  reset.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    host.configure({ ...DEFAULT_WRITING_GUIDES });
    pickerWrap.addClass("is-hidden");
  });

  let previewKey = "";
  const refresh = (): void => {
    const state = host.state();
    const style = writingGuidesOf(state.style);
    enabled.checked = state.enabled;
    if (includeInPreview) includeInPreview.checked = state.includeInPreview === true;

    for (const [key, ctrl] of sliders) {
      const n = style[key as "spacing" | "thickness" | "opacity"];
      ctrl.input.value = String(key === "opacity" ? Math.round(n * 100) : n);
      ctrl.value.textContent =
        key === "opacity"
          ? `${Math.round(n * 100)}%`
          : key === "thickness"
            ? `${n.toFixed(1)} px`
            : `${n} px`;
    }
    for (const [key, btn] of buttons) {
      const active = key === `Overlay style:${style.style}` || key === `Color:${style.colorMode}`;
      btn.toggleClass("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    const color = guideColor(style, state.paper);
    disc.style.backgroundColor = color;
    colorLabel.textContent = style.colorMode === "auto" ? "Auto paper contrast" : style.customColor;
    swatchBtn.disabled = style.colorMode === "auto";
    if (style.colorMode === "auto") pickerWrap.addClass("is-hidden");

    const scale = Math.max(0.1, state.scale);
    hint.textContent = `${(style.spacing * scale).toFixed(0)} px at zoom`;
    const key = JSON.stringify([style, state.paper, Math.round(scale * 100)]);
    if (previewKey === key) return;
    previewKey = key;

    const dpr = Math.min(2, parent.ownerDocument.defaultView?.devicePixelRatio || 1);
    const width = 264;
    const height = 64;
    preview.width = width * dpr;
    preview.height = height * dpr;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = state.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);
    const page = blankPage("guide-preview", { width: width / scale, height: height / scale });
    paintWritingGuides(
      ctx,
      page,
      { minX: 0, minY: 0, maxX: page.geometry.width, maxY: page.geometry.height },
      style,
      state.paper,
      scale,
      scale * dpr,
    );
  };

  refresh();
  return host.subscribe(refresh);
}

export class WritingGuidePopover {
  private readonly el: HTMLElement;
  private readonly cleanups: Array<() => void> = [];
  private closed = false;

  constructor(
    readonly anchorEl: HTMLElement,
    host: WritingGuideHost,
    onClose?: () => void,
  ) {
    const doc = anchorEl.ownerDocument;
    const win = doc.defaultView ?? window;
    this.el = doc.body.createDiv({ cls: "goodobsidian-popover goodobsidian-guide-popover" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Writing guides");

    // Isolate events so tapping inside the popover never flips Live Preview to raw code.
    const stop = (e: Event): void => e.stopPropagation();
    for (const evt of ["mousedown", "pointerdown", "touchstart", "click"] as const) {
      this.el.addEventListener(evt, stop);
      this.cleanups.push(() => this.el.removeEventListener(evt, stop));
    }

    const header = this.el.createDiv({ cls: "goodobsidian-guide-header" });
    header.createSpan({ cls: "goodobsidian-guide-title", text: "Writing guides" });
    const closeBtn = header.createEl("button", {
      cls: "clickable-icon goodobsidian-guide-close",
      attr: { "aria-label": "Close" },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    this.cleanups.push(renderWritingGuideControls(this.el, host));

    const place = (): void => {
      const rect = anchorEl.getBoundingClientRect();
      const popW = Math.min(300, win.innerWidth - 16);
      this.el.style.width = `${popW}px`;
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - popW / 2, win.innerWidth - popW - 8));
      const popH = this.el.offsetHeight || 360;
      const below = rect.bottom + 8 + popH <= win.innerHeight - 8;
      const top = below ? rect.bottom + 8 : Math.max(8, rect.top - popH - 8);
      this.el.style.position = "fixed";
      this.el.style.transform = "none";
      this.el.style.left = `${Math.round(left)}px`;
      this.el.style.top = `${Math.round(top)}px`;
      this.el.style.zIndex = "60";
    };
    place();
    win.requestAnimationFrame(place);

    const onOutside = (e: Event): void => {
      const target = e.target as Node | null;
      if (target && (this.el.contains(target) || anchorEl.contains(target))) return;
      this.close();
    };
    const onResize = (): void => place();
    doc.addEventListener("pointerdown", onOutside, true);
    win.addEventListener("resize", onResize);
    this.cleanups.push(() => {
      doc.removeEventListener("pointerdown", onOutside, true);
      win.removeEventListener("resize", onResize);
      onClose?.();
    });
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.el.remove();
  }
}

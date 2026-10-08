import { setIcon } from "obsidian";
import { bindPresetDrag } from "./preset-drag";
import { nearestStop } from "../model/pen-widths";
import {
  createStrokePreview,
  previewThicknessLabel,
  type StrokePreviewOptions,
} from "./stroke-preview";
export interface ThicknessEditorOptions {
  title?: string;
  resetLabel?: string;
  measurement?: string;
  preview?: (width: number, compact: boolean, doc: Document) => Node;
  current: () => StrokePreviewOptions;
  presets: () => readonly number[];
  stops: readonly number[];
  slotIds?: () => readonly string[];
  selectedSlot?: () => string | null;
  editing?: () => string | undefined;
  edit?: (id: string) => void;
  selectSlot?: (id: string) => void;
  select: (width: number) => void;
  reset: () => void;
  reorder?: (from: number, to: number) => void;
  dragging?: (active: boolean) => void;
  manage?: {
    save: (width: number, replacing?: number | string) => void;
    remove: (width: number | string) => void;
    restore: () => void;
  };
}
/** One compact editor: a live sample, actual nib mm, slider and visual presets. */
export function renderThicknessEditor(
  body: HTMLElement,
  options: ThicknessEditorOptions,
): (() => void) & { dispose: () => void } {
  let disposers: Array<() => void> = [];
  body.addClass("goodobsidian-thickness-editor");
  const head = body.createDiv({ cls: "goodobsidian-width-head" });
  head.createDiv({ cls: "goodobsidian-popover-label goodobsidian-size-title", text: options.title ?? "Stroke thickness" });
  const readout = head.createSpan({
    cls: "goodobsidian-width-readout",
    attr: { "aria-live": "polite" },
  });
  const preview = body.createDiv({ cls: "goodobsidian-live-stroke" });
  const hint = body.createDiv({ cls: "goodobsidian-size-hint" });
  const slider = body.createDiv({ cls: "goodobsidian-thickness-slider" });
  const range = slider.createEl("input", {
    type: "range",
    cls: "goodobsidian-thickness-range",
    attr: { "aria-label": options.title ?? "Stroke thickness" },
  });
  range.min = "0";
  range.max = String(options.stops.length - 1);
  range.step = "1";
  const limits = slider.createDiv({ cls: "goodobsidian-size-limits", attr: { "aria-hidden": "true" } });
  const minimum = limits.createSpan(), maximum = limits.createSpan();
  body.createDiv({ cls: "goodobsidian-popover-label", text: options.manage ? "Saved presets" : "Quick sizes" });
  const list = body.createDiv({ cls: "goodobsidian-thickness-presets" });
  const button = (parent: HTMLElement, label: string, run: () => void) => {
    const el = parent.createEl("button", {
      cls: "clickable-icon",
      text: label,
      attr: { "aria-label": label, title: label },
    });
    el.addEventListener("click", run);
    return el;
  };
  const footer = body.createDiv({ cls: "goodobsidian-thickness-actions" });
  button(footer, options.resetLabel ?? "Reset thickness", () => {
    options.reset();
    refresh();
  });
  let add: HTMLButtonElement | null = null;
  if (options.manage) {
    add = button(footer, "Add width preset", () => {
      options.manage!.save(options.current().width, options.editing?.());
      refresh();
    });
    add.addClass("mod-cta");
    add.hidden = !!options.editing?.();
    button(footer, "Restore default presets", () => {
      options.manage!.restore();
      refresh();
    });
  }
  const refresh = (): void => {
    const current = options.current(),
      label = previewThicknessLabel(current.type, current.width);
    head
      .querySelector?.(".goodobsidian-popover-label")
      ?.setText(options.title ?? "Stroke thickness");
    hint.setText(options.manage
      ? options.editing?.() ? "Adjust this preset. Changes save automatically." : "Adjust the slider, then add a width preset."
      : `Adjust ${options.measurement ?? "thickness"}. Changes apply immediately.`);
    minimum.setText(previewThicknessLabel(current.type, options.stops[0]));
    maximum.setText(previewThicknessLabel(current.type, options.stops[options.stops.length - 1]));
    readout.setText(label);
    range.value = String(nearestStop(options.stops, current.width));
    range.setAttribute("aria-valuetext", `${label} ${options.measurement ?? "thickness"}`);
    preview.replaceChildren(options.preview?.(current.width, false, body.ownerDocument) ?? createStrokePreview(current, body.ownerDocument));
    if (add) add.hidden = !!options.editing?.();
    const scroll = list.scrollTop;
    for (const dispose of disposers) dispose();
    disposers = [];
    list.empty();
    for (const [index, width] of options.presets().entries()) {
      const id = options.slotIds?.()[index];
      const active =
        id && options.selectedSlot ? options.selectedSlot() === id : width === current.width;
      const row = list.createDiv({ cls: "goodobsidian-thickness-row" });
      row.setAttribute("data-preset-index", String(index));
      row.toggleClass("has-reorder", !!options.reorder);
      row.toggleClass("has-remove", !!options.manage);
      const name = previewThicknessLabel(current.type, width);
      if (options.reorder) {
        const handle = button(row, `Move ${name} width`, () => {});
        handle.addClass("goodobsidian-preset-handle");
        setIcon(handle, "grip-vertical");
        disposers.push(bindPresetDrag(handle, row, index, (from, to) => {
          options.reorder!(from, to);
          refresh();
          list.children[to]?.querySelector<HTMLElement>(".goodobsidian-preset-handle")?.focus();
        }, options.dragging ?? (() => {})));
      }
      const pick = button(row, `${name} ${options.measurement ?? "thickness"}`, () => {
        if (active && id && options.edit) options.edit(id);
        else if (id && options.selectSlot) options.selectSlot(id);
        else options.select(width);
        refresh();
      });
      pick.empty();
      pick.addClass("goodobsidian-thickness-choice");
      pick.append(options.preview?.(width, true, body.ownerDocument) ?? createStrokePreview({ ...current, width, compact: true }, body.ownerDocument));
      pick.createSpan({ cls: "goodobsidian-size-value", text: name });
      const check = pick.createSpan({ cls: "goodobsidian-size-check" });
      setIcon(check, "check");
      check.style.visibility = active ? "visible" : "hidden";
      pick.toggleClass("is-active", !!active);
      pick.setAttribute("aria-pressed", String(!!active));
      if (options.manage) {
        const remove = button(row, `Remove ${name} width`, () => {
          options.manage!.remove(id ?? width);
          refresh();
        });
        remove.empty();
        remove.addClass("goodobsidian-size-remove");
        setIcon(remove, "trash-2");
      }
    }
    list.scrollTop = scroll;
  };
  range.addEventListener("input", () => {
    const width = options.stops[Number(range.value)];
    if (width !== undefined) {
      options.select(width);
      refresh();
    }
  });
  refresh();
  return Object.assign(refresh, { dispose: () => {
    for (const dispose of disposers) dispose();
    disposers = [];
  } });
}

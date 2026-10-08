import { setIcon } from "obsidian";
import { bindPresetDrag } from "./preset-drag";
import { nearestStop } from "../model/pen-widths";
import {
  createStrokePreview,
  previewThicknessLabel,
  type StrokePreviewOptions,
} from "./stroke-preview";
export interface ThicknessEditorOptions {
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
  head.createDiv({ cls: "goodobsidian-popover-label", text: "Stroke thickness" });
  const readout = head.createSpan({
    cls: "goodobsidian-width-readout",
    attr: { "aria-live": "polite" },
  });
  const preview = body.createDiv({ cls: "goodobsidian-live-stroke" });
  const range = body.createEl("input", {
    type: "range",
    cls: "goodobsidian-thickness-range",
    attr: { "aria-label": "Stroke thickness" },
  });
  range.min = "0";
  range.max = String(options.stops.length - 1);
  range.step = "1";
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
  button(footer, "Reset thickness", () => {
    options.reset();
    refresh();
  });
  if (options.manage) {
    const add = button(footer, "Add current width", () => {
      options.manage!.save(options.current().width, options.editing?.());
      refresh();
    });
    add.hidden = !!options.editing?.();
    button(footer, "Restore width presets", () => {
      options.manage!.restore();
      refresh();
    });
  }
  const refresh = (): void => {
    const current = options.current(),
      label = previewThicknessLabel(current.type, current.width);
    head
      .querySelector?.(".goodobsidian-popover-label")
      ?.setText(options.editing?.() ? "Edit width slot" : "Stroke thickness");
    readout.setText(label);
    range.value = String(nearestStop(options.stops, current.width));
    range.setAttribute("aria-valuetext", `${label} thickness`);
    preview.replaceChildren(createStrokePreview(current, body.ownerDocument));
    footer.querySelectorAll("button").forEach((el) => {
      if (el.textContent === "Add current width") el.hidden = !!options.editing?.();
    });
    for (const dispose of disposers) dispose();
    disposers = [];
    list.empty();
    for (const [index, width] of options.presets().entries()) {
      const id = options.slotIds?.()[index];
      const active =
        id && options.selectedSlot ? options.selectedSlot() === id : width === current.width;
      const row = list.createDiv({ cls: "goodobsidian-thickness-row" });
      row.setAttribute("data-preset-index", String(index));
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
      const pick = button(row, `${name} thickness`, () => {
        if (active && id && options.edit) options.edit(id);
        else if (id && options.selectSlot) options.selectSlot(id);
        else options.select(width);
        refresh();
      });
      pick.empty();
      pick.addClass("goodobsidian-thickness-choice");
      pick.append(createStrokePreview({ ...current, width, compact: true }, body.ownerDocument));
      pick.createSpan({ text: name });
      pick.toggleClass("is-active", !!active);
      pick.setAttribute("aria-pressed", String(!!active));
      if (options.manage) {
        button(row, `Remove ${name} width`, () => {
          options.manage!.remove(id ?? width);
          refresh();
        }).setText("×");
      }
    }
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

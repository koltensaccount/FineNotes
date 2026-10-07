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
  select: (width: number) => void;
  reset: () => void;
  manage?: {
    save: (width: number, replacing?: number) => void;
    remove: (width: number) => void;
    restore: () => void;
  };
}
/** One compact editor: a live sample, actual nib mm, slider and visual presets. */
export function renderThicknessEditor(
  body: HTMLElement,
  options: ThicknessEditorOptions,
): () => void {
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
    button(footer, "Save current width", () => {
      options.manage!.save(options.current().width);
      refresh();
    });
    button(footer, "Restore width presets", () => {
      options.manage!.restore();
      refresh();
    });
  }
  const refresh = (): void => {
    const current = options.current(),
      label = previewThicknessLabel(current.type, current.width);
    readout.setText(label);
    range.value = String(nearestStop(options.stops, current.width));
    range.setAttribute("aria-valuetext", `${label} thickness`);
    preview.setCssStyles({ background: current.paper ?? "#ffffff" });
    preview.replaceChildren(createStrokePreview(current, body.ownerDocument));
    list.empty();
    for (const width of options.presets()) {
      const row = list.createDiv({ cls: "goodobsidian-thickness-row" });
      const name = previewThicknessLabel(current.type, width);
      const pick = button(row, `${name} thickness`, () => {
        options.select(width);
        refresh();
      });
      pick.empty();
      pick.addClass("goodobsidian-thickness-choice");
      pick.append(createStrokePreview({ ...current, width, compact: true }, body.ownerDocument));
      pick.createSpan({ text: name });
      pick.toggleClass("is-active", width === current.width);
      pick.setAttribute("aria-pressed", String(width === current.width));
      if (options.manage) {
        button(row, "Replace this width", () => {
          options.manage!.save(options.current().width, width);
          refresh();
        }).setText("Replace");
        button(row, `Remove ${name} width`, () => {
          options.manage!.remove(width);
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
  return refresh;
}

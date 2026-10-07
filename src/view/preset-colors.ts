import { renderColorPicker } from "./color-picker";
import { bindPresetDrag } from "./preset-drag";
import {
  moveColor,
  restoreColors,
  saveColor,
  type WritingPresets,
  type WritingTool,
} from "../model/writing-presets";

/** One disposable manager per popover; defaults are ordinary editable rows. */
export function renderPresetColors(
  body: HTMLElement,
  presets: WritingPresets,
  tool: WritingTool,
  changed: () => void,
  pick: (color: string) => void,
  dragging: (active: boolean) => void,
  recent: () => readonly string[] = () => [],
  remember: (color: string) => void = () => {},
): () => void {
  let disposers: Array<() => void> = [];
  const clear = (): void => {
    for (const dispose of disposers) dispose();
    disposers = [];
    body.empty();
  };
  const button = (parent: HTMLElement, text: string, run: () => void): HTMLButtonElement => {
    const el = parent.createEl("button", {
      cls: "clickable-icon",
      text,
      attr: { "aria-label": text, title: text },
    });
    el.addEventListener("click", run);
    return el;
  };
  const editor = (index?: number): void => {
    clear();
    button(body, "Back to presets", show);
    const current =
      index === undefined ? presets.selectedColors[tool] : presets.palettes[tool][index];
    const feedback = body.createDiv({ attr: { role: "status" } });
    const save = (color: string, custom = true): void => {
      if (!saveColor(presets, tool, color, index)) {
        feedback.setText("Choose a valid color that is not already in this palette.");
        return;
      }
      if (custom) remember(color);
      changed();
      show();
    };
    const hex = body.createEl("input", {
      type: "text",
      value: current,
      attr: { "aria-label": "HEX color", placeholder: "#rrggbb" },
    });
    button(body, index === undefined ? "Add HEX color" : "Replace with HEX color", () =>
      save(hex.value),
    );
    renderColorPicker(body.createDiv(), {
      current,
      recent: recent(),
      extra: presets.palettes[tool],
      customOpen: true,
      onPick: (color) => {
        if (color) save(color, false);
      },
      onCustom: save,
    });
  };
  const show = (focusIndex?: number): void => {
    clear();
    body.createDiv({
      cls: "goodobsidian-popover-label",
      text: `${tool === "pen" ? "Pen" : "Highlighter"} colors`,
    });
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: "Hold a handle to drag on touch. Drag with a mouse, or use ↑ / ↓ on a focused handle.",
    });
    const list = body.createDiv({ cls: "goodobsidian-preset-list" });
    presets.palettes[tool].forEach((color, index) => {
      const row = list.createDiv({
        cls: "goodobsidian-preset-row",
        attr: { "data-preset-index": String(index) },
      });
      const handle = button(row, `Move ${color}`, () => {});
      handle.setText("↕");
      handle.addClass("goodobsidian-preset-handle");
      disposers.push(
        bindPresetDrag(
          handle,
          row,
          index,
          (from, to) => {
            if (to < 0 || to >= presets.palettes[tool].length || from === to) return;
            moveColor(presets, tool, from, to);
            changed();
            show(to);
          },
          dragging,
        ),
      );
      const swatch = button(row, `Select ${color}`, () => pick(color));
      swatch.setText(color);
      swatch.setCssProps({ "--preset-color": color });
      swatch.addClass("goodobsidian-preset-color");
      swatch.setAttribute("aria-pressed", String(color === presets.selectedColors[tool]));
      button(row, `Edit ${color}`, () => editor(index)).setText("Edit");
      button(row, `Remove ${color}`, () => {
        presets.palettes[tool].splice(index, 1);
        changed();
        show();
      }).setText("×");
      if (focusIndex === index) handle.focus();
    });
    button(body, "Add color", () => editor());
    button(body, "Restore default colors", () => {
      clear();
      body.createDiv({
        text: `Replace all ${tool} color presets with the original defaults? Widths and the selected ink color will be kept.`,
      });
      button(body, "Cancel", show);
      button(body, "Restore default colors", () => {
        restoreColors(presets, tool);
        changed();
        show();
      });
    });
  };
  show();
  return clear;
}

import { setIcon } from "obsidian";
import { renderColorPicker } from "./color-picker";
import { bindPresetDrag } from "./preset-drag";
import {
  moveColor,
  restoreColors,
  saveColor,
  removeColor,
  selectedColor,
  type WritingPresets,
  type WritingTool,
} from "../model/writing-presets";

/** One disposable manager per popover; defaults are ordinary editable rows. */
export function renderPresetColors(
  body: HTMLElement,
  presets: WritingPresets,
  tool: WritingTool,
  changed: () => void,
  pick: (id: string) => void,
  dragging: (active: boolean) => void,
  recent: () => readonly string[] = () => [],
  remember: (color: string) => void = () => {},
  start: "list" | "add" | "restore" | { id: string } = "list",
  finished?: (id: string) => void,
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
  const editor = (id?: string): void => {
    clear();
    button(body, "Back to presets", show);
    const preset =
      id === undefined ? undefined : presets.palettes[tool].find((entry) => entry.id === id);
    if (id !== undefined && !preset) {
      show();
      return;
    }
    const current = preset?.color ?? selectedColor(presets, tool);
    const feedback = body.createDiv({ attr: { role: "status" } });
    const save = (color: string, custom = true): void => {
      const saved = saveColor(presets, tool, color, id);
      if (!saved) {
        feedback.setText("Choose a valid color. If this preset was removed, reopen the editor.");
        return;
      }
      if (custom) remember(color);
      changed();
      if (finished) finished(saved.id);
      else show();
    };
    const hex = body.createEl("input", {
      type: "text",
      value: current,
      attr: { "aria-label": "HEX color", placeholder: "#rrggbb" },
    });
    button(body, id === undefined ? "Add HEX color" : "Replace with HEX color", () =>
      save(hex.value),
    );
    renderColorPicker(body.createDiv(), {
      current,
      recent: recent(),
      extra: presets.palettes[tool].map((entry) => entry.color),
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
    presets.palettes[tool].forEach(({ id, color }, index) => {
      const row = list.createDiv({
        cls: "goodobsidian-preset-row",
        attr: { "data-preset-index": String(index), "data-preset-id": id },
      });
      const handle = button(row, `Move ${color}`, () => {});
      setIcon(handle, "grip-vertical");
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
      const swatch = button(row, `Select ${color}`, () => pick(id));
      swatch.setText(color);
      swatch.setCssProps({ "--preset-color": color });
      swatch.addClass("goodobsidian-preset-color");
      swatch.setAttribute("aria-pressed", String(id === presets.selectedIds[tool]));
      button(row, `Edit ${color}`, () => editor(id)).setText("Edit");
      button(row, `Remove ${color}`, () => {
        removeColor(presets, tool, id);
        changed();
        show();
      }).setText("×");
      if (focusIndex === index) handle.focus();
    });
    button(body, "Add color", () => editor());
    button(body, "Restore default colors", reset);
  };
  const reset = (): void => {
    clear();
    body.createDiv({
      text: `Replace all ${tool} color presets with the original defaults? Widths will be kept. The selection follows a matching default color, or the first default.`,
    });
    button(body, "Cancel", show);
    button(body, "Restore default colors", () => {
      restoreColors(presets, tool);
      changed();
      show();
    });
  };
  if (start === "add") editor();
  else if (start === "restore") reset();
  else if (typeof start === "object") editor(start.id);
  else show();
  return clear;
}

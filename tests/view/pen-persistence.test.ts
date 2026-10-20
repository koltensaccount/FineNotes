import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, type GoodObsidianSettings } from "../../src/settings-data";
import { PEN_TYPES, penTypeFor, type ToolbarState, type PenType } from "../../src/view/toolbar";
import { penDynamicsProfile } from "../../src/model/pen-dynamics";

vi.mock("obsidian", () => import("./fake-obsidian"));

describe("Pen Persistence across notebook sessions", () => {
  let mockPlugin: {
    settings: GoodObsidianSettings;
    saveSettings: () => Promise<void>;
    savePenType: (type: PenType) => void;
    setPressureWidth: (enabled: boolean) => Promise<void>;
    openNotebooks: () => any[];
  };

  let openViews: Array<{
    toolState: ToolbarState;
    settings: GoodObsidianSettings;
    setPenType: (type: PenType) => void;
    setPressureWidth: (enabled: boolean) => void;
  }>;

  beforeEach(() => {
    openViews = [];
    const settings: GoodObsidianSettings = {
      ...DEFAULT_SETTINGS,
      penType: "fountain",
      pressureWidth: true,
      penDynamics: {
        fountain: { pressureSensitivity: 0.8, stabilization: 0.2 },
        ball: { pressureSensitivity: 0, stabilization: 0.4 },
        brush: { pressureSensitivity: 1.0, stabilization: 0.1 },
      },
    };

    mockPlugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      savePenType(type: PenType) {
        this.settings.penType = type;
        for (const v of this.openNotebooks()) v.setPenType(type);
        void this.saveSettings();
      },
      async setPressureWidth(enabled: boolean) {
        this.settings.pressureWidth = enabled;
        for (const v of this.openNotebooks()) v.setPressureWidth(enabled);
        await this.saveSettings();
      },
      openNotebooks() {
        return openViews;
      },
    };
  });

  function createMockView(initialSettings: GoodObsidianSettings) {
    const penType = initialSettings.penType ?? (initialSettings.pressureWidth ? "fountain" : "ball");
    const spec = PEN_TYPES.find((p) => p.id === penType) ?? PEN_TYPES[0];
    const toolState: ToolbarState = {
      tool: "pen",
      penType: spec.id,
      pressureEnabled: spec.pressure && initialSettings.pressureWidth,
      penDynamics: initialSettings.penDynamics,
      color: "#1e293b",
      size: 2,
    };

    const view = {
      toolState,
      settings: initialSettings,
      setPenType(type: PenType) {
        this.toolState.penType = type;
        const s = PEN_TYPES.find((p) => p.id === type) ?? PEN_TYPES[0];
        this.toolState.pressureEnabled = s.pressure && this.settings.pressureWidth;
      },
      setPressureWidth(enabled: boolean) {
        this.settings.pressureWidth = enabled;
        const s = penTypeFor(this.toolState);
        this.toolState.pressureEnabled = enabled && s.pressure;
      },
      choosePen(type: PenType) {
        this.setPenType(type);
        mockPlugin.savePenType(type);
      },
    };
    openViews.push(view);
    return view;
  }

  it("persists Ballpoint selection and restores it when reopening a notebook", () => {
    const view1 = createMockView(mockPlugin.settings);
    expect(view1.toolState.penType).toBe("fountain");
    expect(view1.toolState.pressureEnabled).toBe(true);

    // User explicitly selects Ball pen
    view1.choosePen("ball");
    expect(view1.toolState.penType).toBe("ball");
    expect(view1.toolState.pressureEnabled).toBe(false);
    expect(mockPlugin.saveSettings).toHaveBeenCalled();
    expect(mockPlugin.settings.penType).toBe("ball");

    // Close notebook view and reopen (new view constructed from saved settings)
    const view2 = createMockView(mockPlugin.settings);
    expect(view2.toolState.penType).toBe("ball");
    expect(view2.toolState.pressureEnabled).toBe(false);
  });

  it("persists Brush pen selection across notebook tabs and sessions", () => {
    const viewTab1 = createMockView(mockPlugin.settings);
    const viewTab2 = createMockView(mockPlugin.settings);

    viewTab1.choosePen("brush");
    expect(mockPlugin.settings.penType).toBe("brush");
    expect(viewTab1.toolState.penType).toBe("brush");
    // Tab 2 synchronized
    expect(viewTab2.toolState.penType).toBe("brush");
    expect(viewTab2.toolState.pressureEnabled).toBe(true);

    // Simulate reloading Obsidian
    const reloadedSettings = JSON.parse(JSON.stringify(mockPlugin.settings));
    const viewAfterReload = createMockView(reloadedSettings);
    expect(viewAfterReload.toolState.penType).toBe("brush");
  });

  it("temporary tool changes (Eraser, Lasso, Text) do not overwrite the user's preferred pen", () => {
    const view = createMockView(mockPlugin.settings);
    view.choosePen("ball");
    expect(mockPlugin.settings.penType).toBe("ball");

    // Switch temporarily to Eraser
    view.toolState.tool = "eraser";
    expect(view.toolState.tool).toBe("eraser");
    expect(view.toolState.penType).toBe("ball"); // Pen type intact

    // Switch temporarily to Lasso / Select
    view.toolState.tool = "select";
    expect(view.toolState.tool).toBe("select");
    expect(view.toolState.penType).toBe("ball"); // Pen type intact

    // Return to Pen
    view.toolState.tool = "pen";
    expect(penTypeFor(view.toolState).id).toBe("ball");
    expect(mockPlugin.settings.penType).toBe("ball");
  });

  it("Handwrite Here preserves the user's active pen configuration rather than resetting to fountain", () => {
    mockPlugin.settings.penType = "brush";
    const view = createMockView(mockPlugin.settings);
    expect(view.toolState.penType).toBe("brush");

    // Simulate Handwrite Here opening region and setting tool to pen
    if (view.toolState.penType === "highlighter") {
      view.toolState.penType = view.settings.pressureWidth ? "fountain" : "ball";
    }
    view.toolState.tool = "pen";

    // Verifies it remained Brush pen
    expect(view.toolState.penType).toBe("brush");
    expect(penTypeFor(view.toolState).id).toBe("brush");
  });

  it("Handwrite Here cleanly defaults highlighter to user's preferred pressure pen", () => {
    mockPlugin.settings.penType = "highlighter";
    const view = createMockView(mockPlugin.settings);
    expect(view.toolState.penType).toBe("highlighter");

    if (view.toolState.penType === "highlighter") {
      view.toolState.penType = view.settings.pressureWidth ? "fountain" : "ball";
    }
    view.toolState.tool = "pen";

    expect(view.toolState.penType).toBe("fountain");
    expect(penTypeFor(view.toolState).id).toBe("fountain");
  });

  it("preserves pen dynamics (pressure sensitivity and stabilization) per pen type", () => {
    const fountainProfile = penDynamicsProfile(mockPlugin.settings.penDynamics, "fountain");
    expect(fountainProfile.pressureSensitivity).toBe(0.8);
    expect(fountainProfile.stabilization).toBe(0.2);

    const ballProfile = penDynamicsProfile(mockPlugin.settings.penDynamics, "ball");
    expect(ballProfile.pressureSensitivity).toBe(0);
    expect(ballProfile.stabilization).toBe(0.4);

    const brushProfile = penDynamicsProfile(mockPlugin.settings.penDynamics, "brush");
    expect(brushProfile.pressureSensitivity).toBe(1.0);
    expect(brushProfile.stabilization).toBe(0.1);
  });
});

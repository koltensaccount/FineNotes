/**
 * Interactive 3-View Circuit Editor Modal for FineNotes.
 *
 * Exposes Visual, Blocks/Properties, and CircuitikZ Code views synchronized
 * via a single canonical Kirchhoff IR transaction layer with draft revisions,
 * interactive wire editing, waypoint bend dragging, terminal-to-terminal
 * wire routing, and Obsidian/FineNotes design language.
 */

import { type App, Modal, Notice, setIcon } from "obsidian";
import {
  type CircuitComponent,
  type ComponentType,
  COMPONENT_CATALOG,
  type KirchhoffCircuit,
  cloneCircuit,
  getComponentPortPosition,
  validateCircuitConnectivity,
} from "../circuit/ir";
import { changeComponentType } from "../circuit/component-edit";
import type { CircuitRecognitionReview } from "../circuit/ai-converter";
import { circuitToTikz, tikzToCircuit } from "../circuit/ir2tikz";
import { materializeCircuitGeometry, moveCircuitSegment, snapCircuitComponent, stretchCircuitWires, junctionOnWire, wirePointOrder, type WireEndpoint } from "../circuit/editor-geometry";
import { layoutCircuit, rerouteCircuitWires, routeAllTerminalLeads } from "../circuit/layout";
import { buildWirePathD, renderCircuitToSvg } from "../circuit/svg-render";
import {
  hitTestCircuitWireSegment,
  isMovableJunction,
  simplifyCircuitWire,
} from "../circuit/wire-geometry";

const COMMON_COMPONENT_ORDER: ComponentType[] = [
  "text_label",
  "node_filled",
  "node_open",
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "vsource_dc",
  "vsource",
  "isource",
  "ground",
  "potentiometer",
  "ac_source",
  "switch_spst",
  "switch_spdt",
  "transistor_nmos",
  "transistor_pmos",
  "transistor_npn",
  "transistor_pnp",
  "opamp",
];

export type CircuitEditorTab = "visual" | "blocks" | "code";
export type InteractionMode = "select" | "wire";

export interface CircuitModalOptions {
  circuit: KirchhoffCircuit;
  onSave: (circuit: KirchhoffCircuit, tikz: string, svg: string) => void;
  onCancel?: () => void;
  recognitionReview?: CircuitRecognitionReview;
}

/** Distance from a point (px, py) to a line segment (x1, y1) -> (x2, y2) */
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/** Resolves an endpoint to a valid circuit node ID, allocating a new unused node ID if needed without overwriting existing nodes */
function resolveOrCreateTerminalNode(
  c: KirchhoffCircuit,
  ep: { nodeId?: string; compId?: string; portId?: string },
): string | null {
  if (ep.nodeId && c.nodes[ep.nodeId]) {
    return ep.nodeId;
  }
  if (ep.compId && ep.portId) {
    const comp = c.components[ep.compId];
    if (comp) {
      if (comp.ports[ep.portId] && c.nodes[comp.ports[ep.portId]]) {
        return comp.ports[ep.portId];
      }
      const ppos = getComponentPortPosition(comp, ep.portId);
      let nId = `n_${comp.id}_${ep.portId}`;
      let counter = 1;
      while (c.nodes[nId]) {
        nId = `n_${comp.id}_${ep.portId}_${counter++}`;
      }
      c.nodes[nId] = { id: nId, x: ppos ? ppos.x : comp.x, y: ppos ? ppos.y : comp.y };
      comp.ports[ep.portId] = nId;
      return nId;
    }
  }
  return null;
}

export class CircuitModal extends Modal {
  private circuit: KirchhoffCircuit;
  private readonly onSave: CircuitModalOptions["onSave"];
  private readonly onCancel?: CircuitModalOptions["onCancel"];
  private readonly recognitionReview?: CircuitRecognitionReview;
  private reviewIssuesEl!: HTMLElement;
  private visualInspectorEl!: HTMLElement;

  // State Store
  private activeTab: CircuitEditorTab = "visual";
  private interactionMode: InteractionMode = "select";
  private selectedComponentId: string | null = null;
  private selectedWireId: string | null = null;
  private selectedNodeId: string | null = null;

  // History Undo/Redo stacks
  private historyUndo: KirchhoffCircuit[] = [];
  private historyRedo: KirchhoffCircuit[] = [];

  // Wire drawing endpoint state (deferred transaction: no mutation until wire completes)
  private wireDrawStart: WireEndpoint | null = null;

  // Code draft & revision tracking
  private codeDraft: string = "";
  private codeDraftDirty: boolean = false;
  private codeDiagnostics: Array<{ line: number; message: string; severity: "error" | "warning" }> = [];
  private parseDebounceTimer: number | null = null;

  // Component Picker Popover & Tap-to-Place
  private showComponentPicker: boolean = false;
  private componentPickerSearch: string = "";
  private pendingPlaceType: ComponentType | null = null;

  // Zoom & Pan Viewport State
  private zoomScale: number = 1.0;
  private viewportBasis: string | null = null;
  private hitPixels = 8;
  private panOffset: { x: number; y: number } = { x: 0, y: 0 };
  private isPanning: boolean = false;
  private panStart: { x: number; y: number } = { x: 0, y: 0 };
  private panInitial: { x: number; y: number } = { x: 0, y: 0 };
  private panScreenScale = 1;

  // Visual interaction drag state
  private draggingCompId: string | null = null;
  private draggingWaypoint: { wireId: string; index: number } | null = null;
  private draggingWireSegment: {
    wireId: string;
    segmentIndex: number;
    isHorizontal: boolean;
  } | null = null;
  private draggingJunctionNodeId: string | null = null;
  private draggingLabel: {
    compId: string;
    kind: "label" | "value";
  } | null = null;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private didDragMove: boolean = false;
  private dragInitialSnapshot: KirchhoffCircuit | null = null;
  private capturedPointerId: number | null = null;

  // DOM containers
  private tabHeaderEl!: HTMLElement;
  private bodyContainerEl!: HTMLElement;
  private visualViewEl!: HTMLElement;
  private visualToolbarEl!: HTMLElement;
  private visualBannerEl!: HTMLElement;
  private visualStageEl!: HTMLElement;
  private blocksViewEl!: HTMLElement;
  private codeViewEl!: HTMLElement;
  private codeTextareaEl?: HTMLTextAreaElement;
  private diagnosticsEl?: HTMLElement;

  constructor(app: App, options: CircuitModalOptions) {
    super(app);
    this.circuit = cloneCircuit(options.circuit);
    materializeCircuitGeometry(this.circuit);
    this.onSave = options.onSave;
    this.onCancel = options.onCancel;
    this.recognitionReview = options.recognitionReview;
    this.refreshElectricalDiagnostics();
    this.codeDraft = circuitToTikz(this.circuit);

    // Auto-select first component if available
    const firstComp = Object.keys(this.circuit.components)[0];
    if (firstComp) {
      this.selectedComponentId = firstComp;
    }
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("goodobsidian-circuit-modal");
    contentEl.empty();
    contentEl.addClass("goodobsidian-circuit-modal-content");

    const isEditingText = (evt?: KeyboardEvent): boolean => {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable ||
          Boolean(active.closest("input, textarea, select, [contenteditable='true'], .goodobsidian-blocks-inspector, .goodobsidian-circuit-context")))
      ) {
        return true;
      }
      const target = evt?.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest("input, textarea, select, [contenteditable='true'], .goodobsidian-blocks-inspector, .goodobsidian-circuit-context")))
      ) {
        return true;
      }
      return false;
    };

    // Register keyboard shortcuts
    this.scope.register(["Mod"], "z", (evt) => {
      if (isEditingText(evt)) return;
      evt.preventDefault();
      this.undo();
      return false;
    });
    this.scope.register(["Mod", "Shift"], "z", (evt) => {
      if (isEditingText(evt)) return;
      evt.preventDefault();
      this.redo();
      return false;
    });
    this.scope.register([], "Backspace", (evt) => {
      if (isEditingText(evt)) return;
      this.handleDeleteSelected();
    });
    this.scope.register([], "Delete", (evt) => {
      if (isEditingText(evt)) return;
      this.handleDeleteSelected();
    });
    this.scope.register([], "Escape", () => {
      if (this.wireDrawStart) {
        this.wireDrawStart = null;
        this.renderVisualView();
        new Notice("Wire drawing cancelled");
      } else {
        this.selectedComponentId = null;
        this.selectedWireId = null;
        this.selectedNodeId = null;
        this.renderVisualView();
      }
    });

    // Header with title and segmented tabs
    const headerEl = contentEl.createDiv({ cls: "goodobsidian-circuit-header" });
    const titleEl = headerEl.createDiv({ cls: "goodobsidian-circuit-title" });
    titleEl.createEl("h2", { text: this.recognitionReview ? "Review circuit" : "Circuit Editor" });

    this.tabHeaderEl = headerEl.createDiv({ cls: "goodobsidian-circuit-tabs" });
    this.buildTabButtons();

    const actionsEl = headerEl.createDiv({ cls: "goodobsidian-circuit-header-actions" });
    const cancelBtn = actionsEl.createEl("button", {
      text: "Cancel",
      cls: "goodobsidian-circuit-btn mod-cancel",
    });
    cancelBtn.onclick = () => {
      this.onCancel?.();
      this.close();
    };

    const saveBtn = actionsEl.createEl("button", {
      text: this.recognitionReview ? "Use circuit" : "Save Circuit",
      cls: "goodobsidian-circuit-btn mod-cta",
    });
    saveBtn.onclick = () => this.handleSave();

    this.reviewIssuesEl = contentEl.createDiv({ cls: "goodobsidian-circuit-review-issues" });
    this.renderReviewIssues();

    // Body container
    this.bodyContainerEl = contentEl.createDiv({ cls: "goodobsidian-circuit-body" });

    this.visualViewEl = this.bodyContainerEl.createDiv({ cls: "goodobsidian-circuit-view is-visual" });
    this.visualToolbarEl = this.visualViewEl.createDiv({ cls: "goodobsidian-circuit-toolbar" });
    this.visualBannerEl = this.visualViewEl.createDiv({ cls: "goodobsidian-circuit-banner-container" });
    const workspace = this.visualViewEl.createDiv({ cls: "goodobsidian-circuit-workspace has-details" });
    this.visualStageEl = workspace.createDiv({ cls: "goodobsidian-visual-stage" });
    const aside = workspace.createDiv({ cls: "goodobsidian-circuit-context" });
    if (this.recognitionReview) {
      const original = aside.createEl("details", { cls: "goodobsidian-circuit-original" });
      original.open = true;
      original.createEl("summary", { text: "Original drawing" });
      original.createEl("img", { attr: { src: this.recognitionReview.originalImage, alt: "Selected handwritten circuit before conversion" } });
      original.createEl("p", { text: "Your ink stays unchanged until you choose Use circuit." });
      const copyReport = original.createEl("button", { text: "Copy debug report", cls: "goodobsidian-circuit-btn" });
      copyReport.title = "Copy the selected image and recognition stages locally; nothing is uploaded";
      copyReport.onclick = () => {
        void navigator.clipboard.writeText(JSON.stringify({ ...this.recognitionReview, edited: this.circuit }, null, 2))
          .then(() => new Notice("Debug report copied. It includes your selected drawing."))
          .catch(() => new Notice("Could not copy the debug report."));
      };
    }
    this.visualInspectorEl = aside.createDiv({ cls: "goodobsidian-blocks-inspector goodobsidian-circuit-context-inspector" });
    this.visualInspectorEl.addEventListener("keydown", (e) => e.stopPropagation(), true);

    // Mount pointer event handlers ONCE on the persistent visualStageEl
    this.visualStageEl.onpointerdown = (ev) => this.handleStagePointerDown(ev);
    this.visualStageEl.onpointermove = (ev) => this.handleStagePointerMove(ev);
    this.visualStageEl.onpointerup = (ev) => this.handleStagePointerUp(ev);
    this.visualStageEl.onpointercancel = (ev) => this.handleStagePointerCancel(ev);

    this.blocksViewEl = this.bodyContainerEl.createDiv({ cls: "goodobsidian-circuit-view is-blocks is-hidden" });
    this.codeViewEl = this.bodyContainerEl.createDiv({ cls: "goodobsidian-circuit-view is-code is-hidden" });

    this.renderVisualView();
    this.renderBlocksView();
    this.renderCodeView();
    this.switchTab(this.activeTab);
  }

  override onClose(): void {
    this.cancelActiveDrag();
    if (this.parseDebounceTimer !== null) {
      window.clearTimeout(this.parseDebounceTimer);
      this.parseDebounceTimer = null;
    }
    this.contentEl.empty();
  }

  private buildTabButtons(): void {
    this.tabHeaderEl.empty();

    const tabs: Array<{ id: CircuitEditorTab; label: string; icon: string }> = [
      { id: "visual", label: "Visual", icon: "layout-grid" },
      { id: "code", label: "CircuitikZ Code", icon: "code" },
    ];

    for (const tab of tabs) {
      const btn = this.tabHeaderEl.createEl("button", {
        cls: `goodobsidian-circuit-tab-btn ${this.activeTab === tab.id ? "is-active" : ""}`,
      });
      const iconSpan = btn.createSpan({ cls: "goodobsidian-tab-icon" });
      setIcon(iconSpan, tab.icon);
      btn.createSpan({ text: tab.label });
      btn.onclick = () => this.switchTab(tab.id);
    }
  }

  private switchTab(tab: CircuitEditorTab): void {
    if (this.activeTab === "code" && tab !== "code" && this.codeDraftDirty) {
      this.flushCodeParse();
    }

    this.activeTab = tab;
    this.buildTabButtons();

    this.visualViewEl.toggleClass("is-hidden", tab === "code");
    this.blocksViewEl.toggleClass("is-hidden", true);
    this.visualViewEl.querySelector(".goodobsidian-circuit-workspace")?.classList.add("has-details");
    this.visualInspectorEl.classList.remove("is-hidden");
    this.codeViewEl.toggleClass("is-hidden", tab !== "code");

    if (tab === "visual" || tab === "blocks") {
      this.renderVisualView();
    } else if (tab === "code") {
      if (!this.codeDraftDirty) {
        this.codeDraft = circuitToTikz(this.circuit);
        if (this.codeTextareaEl) {
          this.codeTextareaEl.value = this.codeDraft;
        }
      }
    }
  }

  // --- Central Transaction & Undo/Redo Layer -------------------------------

  private pushHistory(circuit: KirchhoffCircuit): void {
    this.historyUndo.push(cloneCircuit(circuit));
    if (this.historyUndo.length > 50) this.historyUndo.shift();
    this.historyRedo = [];
  }

  private cancelActiveDrag(): void {
    if (this.capturedPointerId !== null) {
      try {
        if (this.visualStageEl.hasPointerCapture(this.capturedPointerId)) {
          this.visualStageEl.releasePointerCapture(this.capturedPointerId);
        }
      } catch { /* Pointer capture may already be released by the browser. */ }
      this.capturedPointerId = null;
    }
    if (this.didDragMove && this.dragInitialSnapshot) {
      this.circuit = this.dragInitialSnapshot;
    }
    this.draggingWaypoint = null;
    this.draggingCompId = null;
    this.draggingWireSegment = null;
    this.draggingJunctionNodeId = null;
    this.draggingLabel = null;
    this.isPanning = false;
    this.dragInitialSnapshot = null;
    this.didDragMove = false;
  }

  private finishActiveDrag(): void {
    if (this.capturedPointerId !== null) {
      try {
        if (this.visualStageEl.hasPointerCapture(this.capturedPointerId)) {
          this.visualStageEl.releasePointerCapture(this.capturedPointerId);
        }
      } catch { /* Pointer capture may already be released by the browser. */ }
      this.capturedPointerId = null;
    }
    const hadDrag = Boolean(
      this.draggingWaypoint ||
      this.draggingCompId ||
      this.draggingWireSegment ||
      this.draggingJunctionNodeId ||
      this.draggingLabel
    );
    this.draggingWaypoint = null;
    this.draggingCompId = null;
    this.draggingWireSegment = null;
    this.draggingJunctionNodeId = null;
    this.draggingLabel = null;
    this.isPanning = false;

    if (hadDrag && this.didDragMove && this.dragInitialSnapshot) {
      this.pushHistory(this.dragInitialSnapshot);
    }
    this.dragInitialSnapshot = null;
    this.didDragMove = false;
  }

  private undo(): void {
    if (this.parseDebounceTimer !== null) {
      window.clearTimeout(this.parseDebounceTimer);
      this.parseDebounceTimer = null;
    }
    if (this.historyUndo.length === 0) return;
    this.cancelActiveDrag();
    this.historyRedo.push(cloneCircuit(this.circuit));
    const prev = this.historyUndo.pop()!;
    this.circuit = prev;
    this.refreshElectricalDiagnostics();
    this.renderReviewIssues();
    this.selectedComponentId = null;
    this.selectedWireId = null;
    this.selectedNodeId = null;
    this.wireDrawStart = null;
    this.codeDraft = circuitToTikz(this.circuit);
    this.codeDraftDirty = false;
    this.codeDiagnostics = [];

    if (this.codeTextareaEl) {
      this.codeTextareaEl.value = this.codeDraft;
    }

    if (this.activeTab === "visual") this.renderVisualView();
    else if (this.activeTab === "blocks") this.renderBlocksView();
    else if (this.activeTab === "code") this.renderDiagnostics();

    new Notice("Undo");
  }

  private redo(): void {
    if (this.parseDebounceTimer !== null) {
      window.clearTimeout(this.parseDebounceTimer);
      this.parseDebounceTimer = null;
    }
    if (this.historyRedo.length === 0) return;
    this.cancelActiveDrag();
    this.historyUndo.push(cloneCircuit(this.circuit));
    const next = this.historyRedo.pop()!;
    this.circuit = next;
    this.refreshElectricalDiagnostics();
    this.renderReviewIssues();
    this.selectedComponentId = null;
    this.selectedWireId = null;
    this.selectedNodeId = null;
    this.wireDrawStart = null;
    this.codeDraft = circuitToTikz(this.circuit);
    this.codeDraftDirty = false;
    this.codeDiagnostics = [];

    if (this.codeTextareaEl) {
      this.codeTextareaEl.value = this.codeDraft;
    }

    if (this.activeTab === "visual") this.renderVisualView();
    else if (this.activeTab === "blocks") this.renderBlocksView();
    else if (this.activeTab === "code") this.renderDiagnostics();

    new Notice("Redo");
  }

  private mutateCircuit(fn: (c: KirchhoffCircuit) => void, recordHistory = true): void {
    if (this.parseDebounceTimer !== null) {
      window.clearTimeout(this.parseDebounceTimer);
      this.parseDebounceTimer = null;
    }
    this.finishActiveDrag();
    if (recordHistory) {
      this.pushHistory(this.circuit);
    }
    const next = cloneCircuit(this.circuit);
    fn(next);
    materializeCircuitGeometry(next);
    this.circuit = next;
    this.refreshElectricalDiagnostics();
    this.renderReviewIssues();

    this.codeDraft = circuitToTikz(this.circuit);
    this.codeDraftDirty = false;
    this.codeDiagnostics = [];

    if (this.codeTextareaEl) {
      this.codeTextareaEl.value = this.codeDraft;
    }

    if (this.activeTab === "visual") this.renderVisualView();
    else if (this.activeTab === "blocks") this.renderBlocksView();
  }

  // --- View A: Visual Editor ----------------------------------------------

  private renderVisualView(): void {
    this.renderVisualToolbar();
    this.renderVisualBanner();
    this.renderVisualStage();
    this.visualInspectorEl.empty();
    this.renderInspector(this.visualInspectorEl);
  }

  private renderVisualToolbar(): void {
    this.visualToolbarEl.empty();

    // 1. Tool Mode Segmented Control (Select vs Draw Wire)
    const modeGroup = this.visualToolbarEl.createDiv({ cls: "goodobsidian-circuit-btn-group" });

    const selectBtn = modeGroup.createEl("button", {
      cls: `goodobsidian-circuit-btn ${this.interactionMode === "select" ? "is-active" : ""}`,
      title: "Select and move components",
    });
    const selectIcon = selectBtn.createSpan({ cls: "goodobsidian-btn-icon" });
    setIcon(selectIcon, "mouse-pointer");
    selectBtn.createSpan({ text: "Select" });
    selectBtn.setAttribute("aria-pressed", String(this.interactionMode === "select"));
    selectBtn.onclick = () => {
      this.interactionMode = "select";
      this.wireDrawStart = null;
      this.renderVisualView();
    };

    const wireBtn = modeGroup.createEl("button", {
      cls: `goodobsidian-circuit-btn ${this.interactionMode === "wire" ? "is-active" : ""}`,
      title: "Connect terminals",
    });
    const wireIcon = wireBtn.createSpan({ cls: "goodobsidian-btn-icon" });
    setIcon(wireIcon, "git-commit");
    wireBtn.createSpan({ text: "Draw Wire" });
    wireBtn.setAttribute("aria-pressed", String(this.interactionMode === "wire"));
    wireBtn.onclick = () => {
      this.interactionMode = "wire";
      this.wireDrawStart = null;
      this.renderVisualView();
    };

    // 2. Add Component Button (toggles compact searchable component picker)
    const addCompBtn = this.visualToolbarEl.createEl("button", {
      cls: `goodobsidian-circuit-btn ${this.showComponentPicker || this.pendingPlaceType ? "is-active" : ""}`,
      title: "Add a component symbol to the schematic",
    });
    const addIcon = addCompBtn.createSpan({ cls: "goodobsidian-btn-icon" });
    setIcon(addIcon, "plus");
    addCompBtn.createSpan({ text: "Component" });
    addCompBtn.onclick = (e) => {
      e.stopPropagation();
      this.showComponentPicker = !this.showComponentPicker;
      this.renderVisualView();
    };

    // 2b. Add Standalone Label Button
    const addLabelBtn = this.visualToolbarEl.createEl("button", {
      cls: `goodobsidian-circuit-btn ${this.pendingPlaceType === "text_label" ? "is-active" : ""}`,
      title: "Add text or math label (tap schematic to place)",
    });
    const labelIcon = addLabelBtn.createSpan({ cls: "goodobsidian-btn-icon" });
    setIcon(labelIcon, "type");
    addLabelBtn.createSpan({ text: "Label" });
    addLabelBtn.onclick = (e) => {
      e.stopPropagation();
      this.showComponentPicker = false;
      this.pendingPlaceType = this.pendingPlaceType === "text_label" ? null : "text_label";
      this.renderVisualView();
      if (this.pendingPlaceType) {
        new Notice("Tap on schematic to place label.");
      }
    };

    // 3. Undo / Redo controls
    const historyGroup = this.visualToolbarEl.createDiv({ cls: "goodobsidian-circuit-btn-group" });
    const undoBtn = historyGroup.createEl("button", {
      cls: `goodobsidian-circuit-btn ${this.historyUndo.length === 0 ? "is-disabled" : ""}`,
      title: "Undo (Cmd+Z)",
    });
    setIcon(undoBtn, "undo-2");
    undoBtn.disabled = this.historyUndo.length === 0;
    undoBtn.setAttribute("aria-label", "Undo");
    undoBtn.onclick = () => this.undo();

    const redoBtn = historyGroup.createEl("button", {
      cls: `goodobsidian-circuit-btn ${this.historyRedo.length === 0 ? "is-disabled" : ""}`,
      title: "Redo (Cmd+Shift+Z)",
    });
    setIcon(redoBtn, "redo-2");
    redoBtn.disabled = this.historyRedo.length === 0;
    redoBtn.setAttribute("aria-label", "Redo");
    redoBtn.onclick = () => this.redo();

    // 5. Global Schematic Clean, Layout & Zoom Actions
    const layoutGroup = this.visualToolbarEl.createDiv({ cls: "goodobsidian-circuit-btn-group is-right" });

    const fitBtn = layoutGroup.createEl("button", {
      cls: "goodobsidian-circuit-btn",
      title: "Zoom to fit entire circuit",
    });
    setIcon(fitBtn, "maximize");
    fitBtn.createSpan({ text: "Fit" });
    fitBtn.onclick = () => this.zoomToFit();

    const details = layoutGroup.createEl("details", { cls: "goodobsidian-circuit-layout-menu" });
    details.createEl("summary", { text: "Layout", attr: { "aria-label": "Circuit layout actions" } });
    const layoutActions = details.createDiv({ cls: "goodobsidian-circuit-layout-actions" });
    const cleanWiresBtn = layoutActions.createEl("button", {
      cls: "goodobsidian-circuit-btn",
      title: "Clean and orthogonally route all wires around obstacles",
    });
    setIcon(cleanWiresBtn, "sparkles");
    cleanWiresBtn.createSpan({ text: "Route" });
    cleanWiresBtn.onclick = () => this.cleanAllWires();

    const autoLayoutBtn = layoutActions.createEl("button", {
      cls: "goodobsidian-circuit-btn",
      title: "Auto-arrange components and route wires",
    });
    setIcon(autoLayoutBtn, "layout-grid");
    autoLayoutBtn.createSpan({ text: "Arrange" });
    autoLayoutBtn.onclick = () => this.autoLayout();
  }

  private renderVisualBanner(): void {
    this.visualBannerEl.empty();
    if (this.pendingPlaceType) {
      const banner = this.visualBannerEl.createDiv({ cls: "goodobsidian-circuit-banner" });
      const def = COMPONENT_CATALOG[this.pendingPlaceType];
      banner.createSpan({
        text: `Tap schematic to place ${def?.description || this.pendingPlaceType} (or Esc to cancel)`,
      });
      const cancelPlace = banner.createEl("button", {
        text: "Cancel",
        cls: "goodobsidian-circuit-btn-mini",
      });
      cancelPlace.onclick = () => {
        this.pendingPlaceType = null;
        this.renderVisualView();
      };
      return;
    }
    if (this.interactionMode !== "wire") return;

    const banner = this.visualBannerEl.createDiv({ cls: "goodobsidian-circuit-banner" });
    if (this.wireDrawStart) {
      banner.createSpan({
        text: "Connect: tap a terminal, junction or wire. Esc cancels.",
      });
      const cancelWire = banner.createEl("button", {
        text: "Cancel",
        cls: "goodobsidian-circuit-btn-mini",
      });
      cancelWire.onclick = () => {
        this.wireDrawStart = null;
        this.renderVisualView();
      };
    } else {
      banner.createSpan({
        text: "Wire: tap a terminal, junction or wire to start.",
      });
    }
  }

  private renderVisualStage(): void {
    const svgMarkup = renderCircuitToSvg(this.circuit, {
      theme: "light",
      strokeColor: "#0f172a",
      wireColor: "#1e293b",
      showGrid: true,
      showNodes: false,
      showPorts: this.interactionMode === "wire",
      highlightComponentId: this.selectedComponentId ?? undefined,
      highlightWireId: this.selectedWireId ?? undefined,
      highlightNodeId: this.selectedNodeId ?? undefined,
      interactiveOverlay: true,
      padding: 40,
    });

    const parsedSvg = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
    this.visualStageEl.replaceChildren(this.visualStageEl.ownerDocument.importNode(parsedSvg.documentElement, true));
    const svgEl = this.visualStageEl.querySelector("svg");
    if (svgEl) {
      this.viewportBasis ??= svgEl.getAttribute("viewBox") || "";
      svgEl.setAttribute("data-original-viewbox", this.viewportBasis);
      svgEl.style.cursor = this.pendingPlaceType ? "copy" : this.interactionMode === "wire" ? "crosshair" : "default";
      this.applyViewBox();
    }

    if (this.showComponentPicker) {
      this.renderComponentPickerPopover();
    }
    this.renderZoomControls();
  }

  private applyViewBox(): void {
    const svgEl = this.visualStageEl.querySelector("svg");
    if (!svgEl) return;
    const origVb = svgEl.getAttribute("data-original-viewbox") || svgEl.getAttribute("viewBox");
    if (!origVb) return;
    if (!svgEl.hasAttribute("data-original-viewbox")) {
      svgEl.setAttribute("data-original-viewbox", origVb);
    }
    const parts = origVb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
      const [minX, minY, w, h] = parts;
      const scaledW = w / this.zoomScale;
      const scaledH = h / this.zoomScale;
      const centerX = minX + w / 2 - this.panOffset.x;
      const centerY = minY + h / 2 - this.panOffset.y;
      svgEl.setAttribute(
        "viewBox",
        `${(centerX - scaledW / 2).toFixed(2)} ${(centerY - scaledH / 2).toFixed(2)} ${scaledW.toFixed(2)} ${scaledH.toFixed(2)}`,
      );
    }
  }

  private zoomToFit(): void {
    this.viewportBasis = null;
    this.zoomScale = 1.0;
    this.panOffset = { x: 0, y: 0 };
    this.renderVisualStage();
    new Notice("Zoom reset to fit circuit.");
  }

  private renderZoomControls(): void {
    const controls = this.visualStageEl.createDiv({ cls: "goodobsidian-circuit-zoom-controls" });
    const zoomOutBtn = controls.createEl("button", {
      cls: "goodobsidian-circuit-zoom-btn",
      title: "Zoom Out",
      text: "-",
    });
    zoomOutBtn.onclick = (e) => {
      e.stopPropagation();
      this.zoomScale = Math.max(0.35, Math.round((this.zoomScale / 1.25) * 100) / 100);
      this.applyViewBox();
    };

    const fitBtn = controls.createEl("button", {
      cls: "goodobsidian-circuit-zoom-btn",
      title: "Zoom to Fit",
    });
    const fitIcon = fitBtn.createSpan({ cls: "goodobsidian-btn-icon" });
    setIcon(fitIcon, "maximize");
    fitBtn.createSpan({ text: `${Math.round(this.zoomScale * 100)}%` });
    fitBtn.onclick = (e) => {
      e.stopPropagation();
      this.zoomToFit();
    };

    const zoomInBtn = controls.createEl("button", {
      cls: "goodobsidian-circuit-zoom-btn",
      title: "Zoom In",
      text: "+",
    });
    zoomInBtn.onclick = (e) => {
      e.stopPropagation();
      this.zoomScale = Math.min(3.5, Math.round((this.zoomScale * 1.25) * 100) / 100);
      this.applyViewBox();
    };
  }

  private renderComponentPickerPopover(): void {
    const popover = this.visualStageEl.createDiv({ cls: "goodobsidian-comp-picker-popover" });
    popover.onclick = (e) => e.stopPropagation();

    const searchContainer = popover.createDiv({ cls: "goodobsidian-comp-picker-search" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: "Search symbols (R, C, Diode, NMOS...)",
      value: this.componentPickerSearch,
    });
    setTimeout(() => searchInput.focus(), 25);

    const listContainer = popover.createDiv({ cls: "goodobsidian-comp-picker-list" });

    const populateList = () => {
      listContainer.empty();
      const q = this.componentPickerSearch.toLowerCase().trim();
      const allTypes = Object.keys(COMPONENT_CATALOG) as ComponentType[];

      const matches = (type: ComponentType): boolean => {
        if (!q) return true;
        const def = COMPONENT_CATALOG[type];
        return (
          type.toLowerCase().includes(q) ||
          def.labelPrefix.toLowerCase().includes(q) ||
          def.description.toLowerCase().includes(q) ||
          def.defaultLabel.toLowerCase().includes(q)
        );
      };

      const selectType = (type: ComponentType) => {
        this.showComponentPicker = false;
        this.componentPickerSearch = "";
        this.pendingPlaceType = type;
        this.renderVisualView();
        new Notice(`Tap on the schematic to place ${COMPONENT_CATALOG[type]?.description || type}.`);
      };

      if (q) {
        const filtered = allTypes.filter(matches);
        if (filtered.length === 0) {
          listContainer.createDiv({ cls: "goodobsidian-blocks-empty", text: "No components match search." });
          return;
        }
        for (const type of filtered) {
          const def = COMPONENT_CATALOG[type];
          const item = listContainer.createEl("button", { cls: "goodobsidian-comp-picker-item" });
          item.createSpan({ text: def.description });
          item.createSpan({ cls: "comp-code", text: def.labelPrefix });
          item.onclick = () => selectType(type);
        }
        return;
      }

      listContainer.createDiv({ cls: "goodobsidian-comp-picker-section", text: "Common Symbols" });
      for (const type of COMMON_COMPONENT_ORDER) {
        if (matches(type)) {
          const def = COMPONENT_CATALOG[type];
          const item = listContainer.createEl("button", { cls: "goodobsidian-comp-picker-item" });
          item.createSpan({ text: def.description });
          item.createSpan({ cls: "comp-code", text: def.labelPrefix });
          item.onclick = () => selectType(type);
        }
      }

      const otherTypes = allTypes.filter((t) => !COMMON_COMPONENT_ORDER.includes(t));
      if (otherTypes.length > 0) {
        listContainer.createDiv({ cls: "goodobsidian-comp-picker-section", text: "More Symbols" });
        for (const type of otherTypes) {
          if (matches(type)) {
            const def = COMPONENT_CATALOG[type];
            const item = listContainer.createEl("button", { cls: "goodobsidian-comp-picker-item" });
            item.createSpan({ text: def.description });
            item.createSpan({ cls: "comp-code", text: def.labelPrefix });
            item.onclick = () => selectType(type);
          }
        }
      }
    };

    searchInput.oninput = () => {
      this.componentPickerSearch = searchInput.value;
      populateList();
    };

    searchInput.onkeydown = (e) => {
      if (e.key === "Escape") {
        this.showComponentPicker = false;
        this.renderVisualView();
      } else if (e.key === "Enter") {
        const first = listContainer.querySelector<HTMLElement>(".goodobsidian-comp-picker-item");
        if (first) first.click();
      }
    };

    populateList();
  }

  private handleStagePointerDown(ev: PointerEvent): void {
    if ((ev.target as Element | null)?.closest?.("button, input, select, textarea, summary")) return;
    this.hitPixels = ev.pointerType === "touch" ? 14 : 8;
    if (this.capturedPointerId !== null) {
      // Ignore secondary pointer contact while a drag is actively captured
      return;
    }

    const pt = this.svgPoint(ev);
    const gridSize = this.circuit.gridSize || 20;
    const gridX = pt.x / gridSize;
    const gridY = pt.y / gridSize;

    this.didDragMove = false;

    // 0. Tap to place pending component
    if (this.pendingPlaceType) {
      const snapX = Math.round(gridX * 2) / 2;
      const snapY = Math.round(gridY * 2) / 2;
      this.addComponent(this.pendingPlaceType, snapX, snapY);
      this.pendingPlaceType = null;
      this.renderVisualView();
      return;
    }

    // A. Check waypoint handle hits on currently selected wire
    const target = ev.target as HTMLElement | SVGElement | null;
    const wpHandleEl = target?.closest?.("[data-waypoint-wire]") as HTMLElement | null;
    if (wpHandleEl) {
      const wireId = wpHandleEl.getAttribute("data-waypoint-wire");
      const indexStr = wpHandleEl.getAttribute("data-waypoint-index");
      if (wireId && indexStr !== null) {
        const index = parseInt(indexStr, 10);
        try {
          this.visualStageEl.setPointerCapture(ev.pointerId);
          this.capturedPointerId = ev.pointerId;
        } catch { /* Pointer capture may already be released by the browser. */ }
        this.dragInitialSnapshot = cloneCircuit(this.circuit);
        this.draggingWaypoint = { wireId, index };
        this.selectedWireId = wireId;
        this.selectedComponentId = null;
        this.selectedNodeId = null;
        return;
      }
    }

    // B. Check direct label hit test
    const labelEl = target?.closest?.("[data-label-comp][data-label-kind]") as HTMLElement | SVGElement | null;
    if (labelEl) {
      const compId = labelEl.getAttribute("data-label-comp");
      const kind = (labelEl.getAttribute("data-label-kind") || "label") as "label" | "value";
      if (compId && this.circuit.components[compId]) {
        try {
          this.visualStageEl.setPointerCapture(ev.pointerId);
          this.capturedPointerId = ev.pointerId;
        } catch { /* Pointer capture may already be released by the browser. */ }
        this.dragInitialSnapshot = cloneCircuit(this.circuit);
        this.selectedComponentId = compId;
        this.selectedWireId = null;
        this.selectedNodeId = null;
        this.draggingLabel = { compId, kind };
        const comp = this.circuit.components[compId];
        const off = kind === "label" ? comp.labelOffset : comp.valueOffset;
        const gridSize = this.circuit.gridSize || 20;
        const offX = off?.x ?? (parseFloat(labelEl.getAttribute("data-label-offset-x") || "0") / gridSize);
        const offY = off?.y ?? (parseFloat(labelEl.getAttribute("data-label-offset-y") || "0") / gridSize);
        this.dragOffset = {
          x: gridX - (comp.x + offX),
          y: gridY - (comp.y + offY),
        };
        this.renderVisualView();
        return;
      }
    }

    // C. Interaction Mode: Draw Wire
    if (this.interactionMode === "wire") {
      // Validate that pending starting endpoint still exists in circuit; if not, cancel it gracefully
      if (this.wireDrawStart) {
        if (this.wireDrawStart.nodeId && !this.circuit.nodes[this.wireDrawStart.nodeId]) {
          this.wireDrawStart = null;
        } else if (this.wireDrawStart.compId && !this.circuit.components[this.wireDrawStart.compId]) {
          this.wireDrawStart = null;
        }
      }

      const hitPort = this.hitTestPort(gridX, gridY);
      const hitNode = hitPort ? (hitPort.nodeId || null) : this.hitTestNode(gridX, gridY);

      const hitSegment = !hitPort && !hitNode ? hitTestCircuitWireSegment(this.circuit, gridX, gridY, this.pointerTolerance()) : null;
      if (hitPort || hitNode || hitSegment) {
        const currentEndpoint: WireEndpoint = hitPort
          ? { compId: hitPort.compId, portId: hitPort.portId, nodeId: hitPort.nodeId || undefined }
          : hitNode ? { nodeId: hitNode } : { wireId: hitSegment!.wireId, point: { x: gridX, y: gridY } };

        if (!this.wireDrawStart) {
          this.wireDrawStart = currentEndpoint;
          this.selectedNodeId = currentEndpoint.nodeId ?? null;
          this.renderVisualView();
          return;
        }

        // Second click: create wire connection
        const startEndpoint = this.wireDrawStart;
        const isSame =
          (startEndpoint.wireId && startEndpoint.wireId === currentEndpoint.wireId && startEndpoint.point && currentEndpoint.point && Math.hypot(startEndpoint.point.x-currentEndpoint.point.x,startEndpoint.point.y-currentEndpoint.point.y)<.1) ||
          (startEndpoint.nodeId && currentEndpoint.nodeId && startEndpoint.nodeId === currentEndpoint.nodeId) ||
          (Boolean(startEndpoint.compId) &&
            Boolean(currentEndpoint.compId) &&
            startEndpoint.compId === currentEndpoint.compId &&
            Boolean(startEndpoint.portId) &&
            Boolean(currentEndpoint.portId) &&
            startEndpoint.portId === currentEndpoint.portId);

        if (isSame) {
          new Notice("Cannot connect a terminal to itself.");
          this.wireDrawStart = null;
          this.renderVisualView();
          return;
        }

        const newWireId = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        this.selectedWireId = newWireId;
        this.selectedComponentId = null;
        this.selectedNodeId = null;
        this.wireDrawStart = null;

        this.mutateCircuit((c) => {
          const endFirst = startEndpoint.wireId && startEndpoint.wireId === currentEndpoint.wireId && startEndpoint.point && currentEndpoint.point &&
            wirePointOrder(c, startEndpoint.wireId, startEndpoint.point) < wirePointOrder(c, startEndpoint.wireId, currentEndpoint.point);
          let startN: string | null, endN: string | null;
          if (endFirst) { endN = this.resolveWireEndpoint(c, currentEndpoint); startN = this.resolveWireEndpoint(c, startEndpoint); }
          else { startN = this.resolveWireEndpoint(c, startEndpoint); endN = this.resolveWireEndpoint(c, currentEndpoint); }
          if (!startN || !endN) {
            new Notice("Cannot connect: endpoint terminal no longer exists.");
            return;
          }

          c.wires.push({
            id: newWireId,
            fromNode: startN,
            toNode: endN,
          });
          c.wires[c.wires.length-1].userEdited = true;
        });


        return;
      }

      // If clicked blank space while drawing wire, create a new junction node
      if (this.wireDrawStart) {
        const snapX = Math.round(gridX * 2) / 2;
        const snapY = Math.round(gridY * 2) / 2;
        const juncNodeId = `n_junc_${Date.now().toString(36)}`;
        const newWireId = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const startEndpoint = this.wireDrawStart;

        this.wireDrawStart = { nodeId: juncNodeId };
        this.selectedWireId = null;
        this.selectedComponentId = null;
        this.selectedNodeId = juncNodeId;

        this.mutateCircuit((c) => {
          const startN = this.resolveWireEndpoint(c, startEndpoint);
          if (!startN) {
            new Notice("Cannot create junction: starting terminal no longer exists.");
            return;
          }

          c.nodes[juncNodeId] = { id: juncNodeId, x: snapX, y: snapY, junction: true };
          c.wires.push({
            id: newWireId,
            fromNode: startN,
            toNode: juncNodeId,
          });
        });


        return;
      }

      // In Draw Wire mode, taps that miss terminals do not enter Select & Move or drag components
      return;
    }

    // D. Interaction Mode: Select & Move
    // 1. Check hit on components
    for (const comp of Object.values(this.circuit.components)) {
      const def = COMPONENT_CATALOG[comp.type];
      const hw = (def ? def.width : 2) / 2;
      const hh = (def ? def.height : 2) / 2;

      const rad = -comp.rotation * Math.PI / 180;
      const dx = gridX - comp.x, dy = gridY - comp.y;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(localX) <= hw && Math.abs(localY) <= hh) {
        try {
          this.visualStageEl.setPointerCapture(ev.pointerId);
          this.capturedPointerId = ev.pointerId;
        } catch { /* Pointer capture may already be released by the browser. */ }
        this.dragInitialSnapshot = cloneCircuit(this.circuit);
        this.selectedComponentId = comp.id;
        this.selectedWireId = null;
        this.selectedNodeId = null;
        this.draggingCompId = comp.id;
        this.dragOffset = { x: gridX - comp.x, y: gridY - comp.y };
        this.renderVisualView();
        return;
      }
    }

    // 2. Check hit on nodes (distinguish movable junctions vs terminal nodes)
    const hitNode = this.hitTestNode(gridX, gridY);
    if (hitNode) {
      this.selectedNodeId = hitNode;
      this.selectedComponentId = null;
      this.selectedWireId = null;
      if (isMovableJunction(this.circuit, hitNode)) {
        try {
          this.visualStageEl.setPointerCapture(ev.pointerId);
          this.capturedPointerId = ev.pointerId;
        } catch { /* Pointer capture may already be released by the browser. */ }
        this.dragInitialSnapshot = cloneCircuit(this.circuit);
        this.draggingJunctionNodeId = hitNode;
        const node = this.circuit.nodes[hitNode];
        this.dragOffset = { x: gridX - node.x, y: gridY - node.y };
      }
      this.renderVisualView();
      return;
    }

    // 3. Check hit on wire segments (direct LTspice-style segment dragging)
    const segmentHit = hitTestCircuitWireSegment(this.circuit, gridX, gridY, this.pointerTolerance());
    if (segmentHit) {
      const wire = this.circuit.wires.find((w) => w.id === segmentHit.wireId);
      if (wire) {
        try {
          this.visualStageEl.setPointerCapture(ev.pointerId);
          this.capturedPointerId = ev.pointerId;
        } catch { /* Pointer capture may already be released by the browser. */ }
        this.dragInitialSnapshot = cloneCircuit(this.circuit);
        this.selectedWireId = segmentHit.wireId;
        this.selectedComponentId = null;
        this.selectedNodeId = null;
        this.draggingWireSegment = {
          wireId: segmentHit.wireId,
          segmentIndex: segmentHit.segmentIndex,
          isHorizontal: segmentHit.isHorizontal,
        };
        this.renderVisualView();
        return;
      }
    }

    // 4. Fallback check hit on wires
    const hitWire = this.hitTestWire(gridX, gridY);
    if (hitWire) {
      this.selectedWireId = hitWire;
      this.selectedComponentId = null;
      this.selectedNodeId = null;
      this.renderVisualView();
      return;
    }

    // 5. Blank canvas: pan viewport
    this.isPanning = true;
    this.panStart = { x: ev.clientX, y: ev.clientY };
    this.panInitial = { ...this.panOffset };
    this.panScreenScale = Math.abs(this.visualStageEl.querySelector("svg")?.getScreenCTM?.()?.a || 1);
    try { this.visualStageEl.setPointerCapture(ev.pointerId); this.capturedPointerId = ev.pointerId; } catch {}
    this.selectedComponentId = null;
    this.selectedWireId = null;
    this.selectedNodeId = null;
    this.renderVisualView();
  }

  private handleStagePointerMove(ev: PointerEvent): void {
    if (this.capturedPointerId !== null && ev.pointerId !== this.capturedPointerId) {
      return;
    }

    // Canvas panning
    if (this.isPanning) {
      const dx = (ev.clientX - this.panStart.x) / this.panScreenScale;
      const dy = (ev.clientY - this.panStart.y) / this.panScreenScale;
      this.panOffset = {
        x: this.panInitial.x + dx,
        y: this.panInitial.y + dy,
      };
      this.applyViewBox();
      return;
    }

    if (
      !this.draggingWaypoint &&
      !this.draggingCompId &&
      !this.draggingWireSegment &&
      !this.draggingJunctionNodeId &&
      !this.draggingLabel
    ) {
      return;
    }

    const pt = this.svgPoint(ev);
    const gridSize = this.circuit.gridSize || 20;
    const gridX = pt.x / gridSize;
    const gridY = pt.y / gridSize;

    // Track dragging waypoint
    if (this.draggingWaypoint) {
      const { wireId, index } = this.draggingWaypoint;
      const wire = this.circuit.wires.find((w) => w.id === wireId);
      if (wire && wire.waypoints && wire.waypoints[index]) {
        const nextX = Math.round(gridX * 2) / 2;
        const nextY = Math.round(gridY * 2) / 2;
        if (wire.waypoints[index].x !== nextX || wire.waypoints[index].y !== nextY) {
          this.didDragMove = true;
          wire.waypoints[index].x = nextX;
          wire.waypoints[index].y = nextY;
          this.updateWaypointDragVisual(wireId, index);
        }
      }
      return;
    }

    // Track dragging wire segment
    if (this.draggingWireSegment) {
      const { wireId, segmentIndex, isHorizontal } = this.draggingWireSegment;
      const wire = this.circuit.wires.find((w) => w.id === wireId);
      if (wire) {
        const targetCoord = isHorizontal
          ? Math.round(gridY * 2) / 2
          : Math.round(gridX * 2) / 2;
        if (this.dragInitialSnapshot) moveCircuitSegment(this.circuit, this.dragInitialSnapshot, wireId, segmentIndex, targetCoord);
        this.didDragMove = true;
        for (const id of Object.keys(this.circuit.nodes)) {
          const old=this.dragInitialSnapshot?.nodes[id], node=this.circuit.nodes[id];
          if (old && (old.x!==node.x || old.y!==node.y)) this.updateJunctionDragVisual(id);
        }
        this.updateWireSegmentDragVisual(wireId);
      }
      return;
    }

    // Track dragging movable junction
    if (this.draggingJunctionNodeId) {
      const nodeId = this.draggingJunctionNodeId;
      const node = this.circuit.nodes[nodeId];
      if (node) {
        const rawX = gridX - this.dragOffset.x;
        const rawY = gridY - this.dragOffset.y;
        const snappedX = Math.round(rawX * 2) / 2;
        const snappedY = Math.round(rawY * 2) / 2;
        if (node.x !== snappedX || node.y !== snappedY) {
          this.didDragMove = true;
          node.x = snappedX;
          node.y = snappedY;
          if (this.dragInitialSnapshot) stretchCircuitWires(this.circuit, this.dragInitialSnapshot);
          this.updateJunctionDragVisual(nodeId);
        }
      }
      return;
    }

    // Track dragging label
    if (this.draggingLabel) {
      const { compId, kind } = this.draggingLabel;
      const comp = this.circuit.components[compId];
      if (comp) {
        const rawOffX = gridX - this.dragOffset.x - comp.x;
        const rawOffY = gridY - this.dragOffset.y - comp.y;
        const snapOffX = Math.round(rawOffX * 5) / 5;
        const snapOffY = Math.round(rawOffY * 5) / 5;
        if (kind === "label") {
          comp.labelOffset = { x: snapOffX, y: snapOffY, manual: true };
        } else {
          comp.valueOffset = { x: snapOffX, y: snapOffY, manual: true };
        }
        this.didDragMove = true;
        this.updateLabelDragVisual(compId, kind);
      }
      return;
    }

    // Track dragging component
    if (this.draggingCompId) {
      const rawGridX = gridX - this.dragOffset.x;
      const rawGridY = gridY - this.dragOffset.y;

      const snapped = snapCircuitComponent(this.circuit, this.draggingCompId, rawGridX, rawGridY);
      const snappedX = snapped.x;
      const snappedY = snapped.y;

      const comp = this.circuit.components[this.draggingCompId];
      if (comp && (comp.x !== snappedX || comp.y !== snappedY)) {
        this.didDragMove = true;
        comp.x = snappedX;
        comp.y = snappedY;

        // Move component's dedicated nodes
        const isNodeShared = (nodeId: string, currentCompId: string): boolean => {
          for (const other of Object.values(this.circuit.components)) {
            if (other.id !== currentCompId && Object.values(other.ports).includes(nodeId)) {
              return true;
            }
          }
          return false;
        };

        const def = COMPONENT_CATALOG[comp.type];
        if (def) {
          for (const port of def.ports) {
            const nodeId = comp.ports[port.id];
            if (nodeId && this.circuit.nodes[nodeId]) {
              if (!isNodeShared(nodeId, comp.id)) {
                const ppos = getComponentPortPosition(comp, port.id);
                if (ppos) {
                  this.circuit.nodes[nodeId].x = ppos.x;
                  this.circuit.nodes[nodeId].y = ppos.y;
                }
              }
            }
          }
        }

        if (this.dragInitialSnapshot) stretchCircuitWires(this.circuit, this.dragInitialSnapshot);
        this.updateComponentDragVisual(comp.id);
      }
      return;
    }
  }

  private updateWireSegmentDragVisual(wireId: string): void {
    const wire = this.circuit.wires.find((w) => w.id === wireId);
    if (!wire) return;
    const gridSize = this.circuit.gridSize || 20;
    const pathD = buildWirePathD(wire, this.circuit.nodes, gridSize);
    const wirePaths = this.visualStageEl.querySelectorAll(`path[data-wire-id="${wireId}"]`);
    for (let i = 0; i < wirePaths.length; i++) {
      wirePaths[i].setAttribute("d", pathD);
    }
  }

  private updateJunctionDragVisual(nodeId: string): void {
    const node = this.circuit.nodes[nodeId];
    if (!node) return;
    const gridSize = this.circuit.gridSize || 20;

    const nodeDots = this.visualStageEl.querySelectorAll(`circle[data-node-id="${nodeId}"]`);
    for (let i = 0; i < nodeDots.length; i++) {
      nodeDots[i].setAttribute("cx", `${node.x * gridSize}`);
      nodeDots[i].setAttribute("cy", `${node.y * gridSize}`);
    }

    for (const wire of this.circuit.wires) {
      if (wire.fromNode === nodeId || wire.toNode === nodeId) {
        const pathD = buildWirePathD(wire, this.circuit.nodes, gridSize);
        const paths = this.visualStageEl.querySelectorAll(`path[data-wire-id="${wire.id}"]`);
        for (let i = 0; i < paths.length; i++) {
          paths[i].setAttribute("d", pathD);
        }
      }
    }
  }

  private updateLabelDragVisual(compId: string, kind: "label" | "value"): void {
    const comp = this.circuit.components[compId];
    if (!comp) return;
    const gridSize = this.circuit.gridSize || 20;
    const off = kind === "label" ? comp.labelOffset : comp.valueOffset;
    const offX = (off?.x ?? 0) * gridSize;
    const offY = (off?.y ?? 0) * gridSize;
    const posX = comp.x * gridSize + offX;
    const posY = comp.y * gridSize + offY;

    const el = this.visualStageEl.querySelector(`[data-label-comp="${compId}"][data-label-kind="${kind}"]`);
    if (el) {
      if (el.tagName.toLowerCase() === "text") {
        el.setAttribute("x", `${posX}`);
        el.setAttribute("y", `${posY}`);
      } else {
        el.setAttribute("transform", `translate(${posX}, ${posY})`);
      }
    }
  }

  private updateWaypointDragVisual(wireId: string, index: number): void {
    const wire = this.circuit.wires.find((w) => w.id === wireId);
    if (!wire || !wire.waypoints || !wire.waypoints[index]) return;
    const gridSize = this.circuit.gridSize || 20;
    const wp = wire.waypoints[index];

    // Update waypoint handle circle in DOM
    const handleEl = this.visualStageEl.querySelector(
      `circle[data-waypoint-wire="${wireId}"][data-waypoint-index="${index}"]`,
    );
    if (handleEl) {
      handleEl.setAttribute("cx", `${wp.x * gridSize}`);
      handleEl.setAttribute("cy", `${wp.y * gridSize}`);
    }

    // Update wire path elements in DOM
    const newPathD = buildWirePathD(wire, this.circuit.nodes, gridSize);
    const wirePaths = this.visualStageEl.querySelectorAll(`path[data-wire-id="${wireId}"]`);
    for (let i = 0; i < wirePaths.length; i++) {
      wirePaths[i].setAttribute("d", newPathD);
    }
  }

  private updateComponentDragVisual(compId: string): void {
    const comp = this.circuit.components[compId];
    if (!comp) return;
    const gridSize = this.circuit.gridSize || 20;
    const cx = comp.x * gridSize;
    const cy = comp.y * gridSize;

    // 1. Update component group transform
    const compG = this.visualStageEl.querySelector(`g[data-component-id="${compId}"]`);
    if (compG) {
      let transform = `translate(${cx}, ${cy}) scale(${gridSize}) rotate(${comp.rotation})`;
      if (comp.mirror) transform += ` scale(-1, 1)`;
      compG.setAttribute("transform", transform);
    }

    // 2. Update port indicators
    const def = COMPONENT_CATALOG[comp.type];
    if (def) {
      for (const port of def.ports) {
        const ppos = getComponentPortPosition(comp, port.id);
        if (ppos) {
          const portCircle = this.visualStageEl.querySelector(
            `circle[data-port-comp="${compId}"][data-port-id="${port.id}"]`,
          );
          if (portCircle) {
            portCircle.setAttribute("cx", `${ppos.x * gridSize}`);
            portCircle.setAttribute("cy", `${ppos.y * gridSize}`);
          }
        }
      }
    }

    // 3. Update dedicated and shared terminal node circles
    for (const [, nId] of Object.entries(comp.ports)) {
      const node = this.circuit.nodes[nId];
      if (node) {
        const nodeDots = this.visualStageEl.querySelectorAll(`circle[data-node-id="${nId}"]`);
        for (let i = 0; i < nodeDots.length; i++) {
          nodeDots[i].setAttribute("cx", `${node.x * gridSize}`);
          nodeDots[i].setAttribute("cy", `${node.y * gridSize}`);
        }
      }
    }

    // 4. Update terminal leads between ports and nodes (reconcile created and obsolete leads)
    const freshLeads = routeAllTerminalLeads(this.circuit);
    const existingLeadKeys = new Set<string>();
    const svgEl = this.visualStageEl.querySelector("svg");

    for (const lead of freshLeads) {
      if (lead.componentId === compId) {
        existingLeadKeys.add(`${lead.componentId}:${lead.portId}`);
        let leadPath = this.visualStageEl.querySelector(
          `path[data-lead-comp="${compId}"][data-lead-port="${lead.portId}"]`,
        );
        if (!leadPath && svgEl) {
          leadPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          leadPath.setAttribute("fill", "none");
          leadPath.setAttribute("stroke", "var(--text-normal, #1e293b)");
          leadPath.setAttribute("stroke-width", "2");
          leadPath.setAttribute("stroke-linecap", "round");
          leadPath.setAttribute("stroke-linejoin", "round");
          leadPath.setAttribute("data-lead-comp", compId);
          leadPath.setAttribute("data-lead-port", lead.portId);
          if (compG && compG.parentNode) {
            compG.parentNode.insertBefore(leadPath, compG);
          } else {
            svgEl.appendChild(leadPath);
          }
        }
        if (leadPath) {
          leadPath.setAttribute("d", lead.pathD);
        }
      }
    }

    // Remove any leads for this component that no longer exist (e.g. snapped back directly onto node)
    const currentCompLeads = this.visualStageEl.querySelectorAll(`path[data-lead-comp="${compId}"]`);
    for (let i = 0; i < currentCompLeads.length; i++) {
      const el = currentCompLeads[i];
      const pId = el.getAttribute("data-lead-port");
      if (pId && !existingLeadKeys.has(`${compId}:${pId}`)) {
        el.remove();
      }
    }

    // 5. Update component labels
    const labelEls = this.visualStageEl.querySelectorAll(`[data-label-comp="${compId}"][data-label-kind]`);
    for (let i = 0; i < labelEls.length; i++) {
      const el = labelEls[i];
      const offX = parseFloat(el.getAttribute("data-label-offset-x") || "0");
      const offY = parseFloat(el.getAttribute("data-label-offset-y") || "0");
      if (el.tagName.toLowerCase() === "text") {
        el.setAttribute("x", `${cx + offX}`);
        el.setAttribute("y", `${cy + offY}`);
      } else {
        el.setAttribute("transform", `translate(${cx + offX}, ${cy + offY})`);
      }
    }

    // 6. Update connected wires
    const connectedNodeIds = new Set(Object.values(comp.ports));
    for (const wire of this.circuit.wires) {
      if (connectedNodeIds.has(wire.fromNode) || connectedNodeIds.has(wire.toNode)) {
        const pathD = buildWirePathD(wire, this.circuit.nodes, gridSize);
        const paths = this.visualStageEl.querySelectorAll(`path[data-wire-id="${wire.id}"]`);
        for (let i = 0; i < paths.length; i++) {
          paths[i].setAttribute("d", pathD);
        }
      }
    }
  }

  private handleStagePointerUp(ev?: PointerEvent): void {
    if (this.capturedPointerId !== null) {
      if (ev && ev.pointerId !== this.capturedPointerId) {
        return;
      }
    } else if (
      ev &&
      (this.draggingWaypoint ||
        this.draggingCompId ||
        this.draggingWireSegment ||
        this.draggingJunctionNodeId ||
        this.draggingLabel)
    ) {
      return;
    }

    const wireSegmentId = this.draggingWireSegment?.wireId;
    const hadDrag = Boolean(
      this.draggingWaypoint ||
      this.draggingCompId ||
      this.draggingWireSegment ||
      this.draggingJunctionNodeId ||
      this.draggingLabel
    );
    const hadMove = this.didDragMove;
    this.finishActiveDrag();

    if (hadDrag && hadMove) {
      if (wireSegmentId) {
        simplifyCircuitWire(this.circuit, wireSegmentId);
      }
      this.mutateCircuit(() => {}, false);
    }
  }

  private handleStagePointerCancel(ev?: PointerEvent): void {
    if (this.capturedPointerId !== null) {
      if (ev && ev.pointerId !== this.capturedPointerId) {
        return;
      }
    } else if (
      ev &&
      (this.draggingWaypoint ||
        this.draggingCompId ||
        this.draggingWireSegment ||
        this.draggingJunctionNodeId ||
        this.draggingLabel)
    ) {
      return;
    }

    const hadMove = this.didDragMove;
    this.cancelActiveDrag();
    if (hadMove) {
      this.renderVisualView();
    }
  }

  private svgPoint(ev: PointerEvent): { x: number; y: number } {
    const svgEl = this.visualStageEl.querySelector("svg");
    if (!svgEl) return { x: 0, y: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const trans = pt.matrixTransform(ctm.inverse());
      return { x: trans.x, y: trans.y };
    }
    const rect = svgEl.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  private pointerTolerance(): number {
    const svg = this.visualStageEl.querySelector("svg");
    const matrix = svg?.getScreenCTM?.();
    return matrix?.a ? this.hitPixels / (Math.abs(matrix.a) * (this.circuit.gridSize || 20)) : .6;
  }

  private resolveWireEndpoint(c: KirchhoffCircuit, endpoint: WireEndpoint): string | null {
    return endpoint.wireId && endpoint.point ? junctionOnWire(c, endpoint.wireId, endpoint.point) : resolveOrCreateTerminalNode(c, endpoint);
  }

  // --- Hit Testing Helpers -------------------------------------------------

  private hitTestWire(gridX: number, gridY: number): string | null {
    const threshold = this.pointerTolerance();
    let bestWireId: string | null = null;
    let bestDist = threshold;

    for (const wire of this.circuit.wires) {
      const from = this.circuit.nodes[wire.fromNode];
      const to = this.circuit.nodes[wire.toNode];
      if (!from || !to) continue;

      const pts: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
      if (!wire.direct && wire.waypoints && wire.waypoints.length > 0) {
        for (const wp of wire.waypoints) pts.push({ x: wp.x, y: wp.y });
      } else if (!wire.direct && Math.abs(from.x - to.x) > 0.01 && Math.abs(from.y - to.y) > 0.01) {
        pts.push({ x: to.x, y: from.y });
      }
      pts.push({ x: to.x, y: to.y });

      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(gridX, gridY, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (d < bestDist) {
          bestDist = d;
          bestWireId = wire.id;
        }
      }
    }

    return bestWireId;
  }

  private hitTestPort(gridX: number, gridY: number): { compId: string; portId: string; nodeId: string } | null {
    const threshold = this.pointerTolerance();
    for (const comp of Object.values(this.circuit.components)) {
      const def = COMPONENT_CATALOG[comp.type];
      if (!def) continue;
      for (const port of def.ports) {
        const ppos = getComponentPortPosition(comp, port.id);
        if (ppos && Math.hypot(gridX - ppos.x, gridY - ppos.y) <= threshold) {
          return {
            compId: comp.id,
            portId: port.id,
            nodeId: comp.ports[port.id] || "",
          };
        }
      }
    }
    return null;
  }

  private hitTestNode(gridX: number, gridY: number): string | null {
    const threshold = this.pointerTolerance();
    for (const node of Object.values(this.circuit.nodes)) {
      if (Math.hypot(gridX - node.x, gridY - node.y) <= threshold) {
        return node.id;
      }
    }
    return null;
  }

  // --- Actions & Manipulations --------------------------------------------

  private addComponent(type: ComponentType, customX?: number, customY?: number): void {
    const def = COMPONENT_CATALOG[type];
    const prefix = def?.labelPrefix || "C";

    let counter = 1;
    while (this.circuit.components[`${prefix.toLowerCase()}${counter}`]) {
      counter++;
    }
    const id = `${prefix.toLowerCase()}${counter}`;
    const label = `${prefix}${counter}`;

    let cx = customX !== undefined ? customX : 0;
    let cy = customY !== undefined ? customY : 0;
    if (customX === undefined || customY === undefined) {
      const compCount = Object.keys(this.circuit.components).length;
      if (compCount > 0) {
        cx = (compCount % 4) * 4;
        cy = Math.floor(compCount / 4) * 4;
      }
    }

    this.selectedComponentId = id;
    this.selectedWireId = null;
    this.selectedNodeId = null;

    this.mutateCircuit((c) => {
      const comp: CircuitComponent = {
        id,
        type,
        label,
        value: def?.defaultValue,
        x: cx,
        y: cy,
        rotation: 0,
        ports: {},
      };

      if (def) {
        for (const port of def.ports) {
          const nId = `n_${id}_${port.id}`;
          c.nodes[nId] = {
            id: nId,
            x: cx + port.x,
            y: cy + port.y,
          };
          comp.ports[port.id] = nId;
        }
      }

      c.components[id] = comp;
      if ((type === "ground" || type === "earth") && customX !== undefined && customY !== undefined) {
        const hit = hitTestCircuitWireSegment(c, customX, customY, .6);
        const nodeId = hit ? junctionOnWire(c, hit.wireId, { x: customX, y: customY }) : null;
        const port = def?.ports[0];
        if (nodeId && port) {
          delete c.nodes[comp.ports[port.id]];
          comp.ports[port.id] = nodeId;
          comp.x = c.nodes[nodeId].x-port.x; comp.y = c.nodes[nodeId].y-port.y;
        }
      }
    });
  }

  private rotateComponent(compId: string, exactDeg?: number): void {
    this.mutateCircuit((c) => {
      const comp = c.components[compId];
      if (!comp) return;
      comp.rotation = exactDeg !== undefined ? exactDeg : (comp.rotation + 90) % 360;

      for (const [pId, nId] of Object.entries(comp.ports)) {
        const node = c.nodes[nId];
        if (node) {
          const portPos = getComponentPortPosition(comp, pId);
          if (portPos) {
            node.x = portPos.x;
            node.y = portPos.y;
          }
        }
      }
    });
  }

  private deleteComponent(compId: string): void {
    this.selectedComponentId = null;
    if (this.wireDrawStart?.compId === compId) {
      this.wireDrawStart = null;
    }

    this.mutateCircuit((c) => {
      const comp = c.components[compId];
      if (!comp) return;

      const usedNodes = new Set<string>();
      for (const [otherId, otherComp] of Object.entries(c.components)) {
        if (otherId === compId) continue;
        for (const nId of Object.values(otherComp.ports)) {
          usedNodes.add(nId);
        }
      }
      for (const wire of c.wires) {
        usedNodes.add(wire.fromNode);
        usedNodes.add(wire.toNode);
      }

      for (const nId of Object.values(comp.ports)) {
        if (!usedNodes.has(nId)) {
          delete c.nodes[nId];
        }
      }

      delete c.components[compId];
    });

    new Notice("Component deleted");
  }

  private disconnectComponent(compId: string): void {
    this.mutateCircuit((c) => {
      const comp = c.components[compId];
      if (!comp) return;
      const def = COMPONENT_CATALOG[comp.type];
      if (!def) return;
      for (const port of def.ports) {
        const ppos = getComponentPortPosition(comp, port.id) || { x: comp.x, y: comp.y };
        let newNId = `n_${comp.id}_${port.id}_disc`;
        let counter = 1;
        while (c.nodes[newNId]) {
          newNId = `n_${comp.id}_${port.id}_disc_${counter++}`;
        }
        c.nodes[newNId] = { id: newNId, x: ppos.x, y: ppos.y };
        comp.ports[port.id] = newNId;
      }
    });
    new Notice("Component disconnected from circuit terminals.");
  }

  private deleteWire(wireId: string): void {
    if (this.selectedWireId === wireId) {
      this.selectedWireId = null;
    }

    this.mutateCircuit((c) => {
      c.wires = c.wires.filter((w) => w.id !== wireId);
    });

    new Notice("Wire deleted");
  }

  private deleteNode(nodeId: string): void {
    this.selectedNodeId = null;
    if (this.wireDrawStart?.nodeId === nodeId) {
      this.wireDrawStart = null;
    }

    this.mutateCircuit((c) => {
      delete c.nodes[nodeId];
      c.wires = c.wires.filter((w) => w.fromNode !== nodeId && w.toNode !== nodeId);
      for (const comp of Object.values(c.components)) {
        for (const [pId, nId] of Object.entries(comp.ports)) {
          if (nId === nodeId) delete comp.ports[pId];
        }
      }
    });

    new Notice("Node deleted");
  }

  private addBendToWire(wireId: string): void {
    this.mutateCircuit((c) => {
      const wire = c.wires.find((w) => w.id === wireId);
      if (!wire) return;
      const from = c.nodes[wire.fromNode];
      const to = c.nodes[wire.toNode];
      if (!from || !to) return;

      if (!wire.waypoints || wire.waypoints.length === 0) {
        const midX = Math.round(((from.x + to.x) / 2) * 2) / 2;
        wire.waypoints = [{ x: midX, y: from.y }];
      } else {
        const lastWp = wire.waypoints[wire.waypoints.length - 1];
        const midX = Math.round(((lastWp.x + to.x) / 2) * 2) / 2;
        const midY = Math.round(((lastWp.y + to.y) / 2) * 2) / 2;
        wire.waypoints.push({ x: midX, y: midY });
      }
      wire.direct = false;
    });
    new Notice("Added waypoint handle — drag circle to reshape wire");
  }

  private rerouteWire(wireId: string): void {
    this.mutateCircuit((c) => {
      const wire=c.wires.find(w=>w.id===wireId); if(wire)wire.userEdited=false;
      const updated = rerouteCircuitWires(c, [wireId]);
      c.wires = updated.wires;
    });
    new Notice("Wire rerouted cleanly");
  }

  private cleanAllWires(): void {
    this.mutateCircuit((c) => {
      for(const wire of c.wires)wire.userEdited=false;
      const updated = rerouteCircuitWires(c);
      c.wires = updated.wires;
    });
    new Notice("All wires cleaned and rerouted around obstacles");
  }

  private autoLayout(): void {
    this.mutateCircuit((c) => {
      for(const wire of c.wires){wire.userEdited=false;wire.waypoints=undefined;}
      const updated = layoutCircuit(c);
      c.components = updated.components;
      c.nodes = updated.nodes;
      c.wires = updated.wires;
    });
    new Notice("Circuit auto-arranged cleanly");
  }

  private handleDeleteSelected(): void {
    if (this.selectedWireId) {
      this.deleteWire(this.selectedWireId);
    } else if (this.selectedComponentId) {
      this.deleteComponent(this.selectedComponentId);
    } else if (this.selectedNodeId) {
      this.deleteNode(this.selectedNodeId);
    }
  }

  // --- View B: Blocks / Properties Editor ----------------------------------

  private renderBlocksView(): void {
    // Properties keeps the live schematic and its selection beside the inspector.
    this.renderVisualView();
  }

  private renderInspector(inspector: HTMLElement): void {
    // 4. Contextual Selection Actions (Rotate, Add Bend, Delete)
    const actionGroup = inspector.createDiv({ cls: "goodobsidian-circuit-btn-group" });

    if (this.selectedComponentId && this.circuit.components[this.selectedComponentId]) {
      const rotBtn = actionGroup.createEl("button", {
        cls: "goodobsidian-circuit-btn",
        title: "Rotate component 90°",
      });
      setIcon(rotBtn, "rotate-cw");
      rotBtn.createSpan({ text: "Rotate" });
      rotBtn.onclick = () => {
        if (!this.selectedComponentId) return;
        this.rotateComponent(this.selectedComponentId);
      };

      const disconnectBtn = actionGroup.createEl("button", {
        cls: "goodobsidian-circuit-btn",
        title: "Disconnect component from all nodes and wires",
      });
      setIcon(disconnectBtn, "scissors");
      disconnectBtn.createSpan({ text: "Disconnect" });
      disconnectBtn.onclick = () => {
        if (!this.selectedComponentId) return;
        this.disconnectComponent(this.selectedComponentId);
      };
    }

    if (this.selectedWireId) {
      const bendBtn = actionGroup.createEl("button", {
        cls: "goodobsidian-circuit-btn",
        title: "Add waypoint handle to bend this wire",
      });
      setIcon(bendBtn, "corner-down-right");
      bendBtn.createSpan({ text: "Add Bend" });
      bendBtn.onclick = () => {
        if (!this.selectedWireId) return;
        this.addBendToWire(this.selectedWireId);
      };

      const rerouteWireBtn = actionGroup.createEl("button", {
        cls: "goodobsidian-circuit-btn",
        title: "Re-route this wire cleanly around obstacles",
      });
      setIcon(rerouteWireBtn, "git-branch");
      rerouteWireBtn.createSpan({ text: "Reroute" });
      rerouteWireBtn.onclick = () => {
        if (!this.selectedWireId) return;
        this.rerouteWire(this.selectedWireId);
      };
    }

    const hasSelection = Boolean(this.selectedComponentId || this.selectedWireId || this.selectedNodeId);
    if (hasSelection) {
      const delBtn = actionGroup.createEl("button", {
        cls: "goodobsidian-circuit-btn mod-warning",
        title: "Delete selected item (Delete / Backspace)",
      });
      setIcon(delBtn, "trash-2");
      delBtn.createSpan({ text: "Delete" });
      delBtn.onclick = () => this.handleDeleteSelected();
    }



    // Scenario 1: Selected Wire Inspector
    if (this.selectedWireId) {
      const wire = this.circuit.wires.find((w) => w.id === this.selectedWireId);
      if (wire) {
        inspector.createEl("h3", { text: "Connection" });

        const fromGroup = inspector.createDiv({ cls: "setting-item" });
        fromGroup.createDiv({ cls: "setting-item-name", text: "From" });
        this.renderWireEndpoint(fromGroup, wire.id, "fromNode");

        const toGroup = inspector.createDiv({ cls: "setting-item" });
        toGroup.createDiv({ cls: "setting-item-name", text: "To" });
        this.renderWireEndpoint(toGroup, wire.id, "toNode");

        const straighten = inspector.createEl("button", { text: "Straighten wire", cls: "goodobsidian-circuit-btn" });
        straighten.onclick = () => this.mutateCircuit(c => {
          const live=c.wires.find(w=>w.id===wire.id);
          if(live){ live.waypoints=[]; live.direct=false; live.userEdited=true; }
        });
        const directGroup = inspector.createDiv({ cls: "setting-item" });
        directGroup.createDiv({ cls: "setting-item-name", text: "Direct (diagonal) routing" });
        const directCheckbox = directGroup.createEl("input", { type: "checkbox" });
        directCheckbox.checked = Boolean(wire.direct);
        directCheckbox.onchange = () => {
          this.mutateCircuit((c) => {
            const w = c.wires.find((item) => item.id === wire.id);
            if (w) {
              w.direct = directCheckbox.checked;
              if (w.direct) {
                w.waypoints = undefined;
              }
            }
          });
        };

        const rerouteActionBtn = inspector.createEl("button", {
          text: "Reroute Wire Around Obstacles",
          cls: "goodobsidian-circuit-btn",
        });
        rerouteActionBtn.onclick = () => this.rerouteWire(wire.id);

        const deleteWireBtn = inspector.createEl("button", {
          text: "Delete Wire",
          cls: "goodobsidian-circuit-btn mod-warning goodobsidian-delete-btn",
        });
        deleteWireBtn.onclick = () => this.deleteWire(wire.id);
        return;
      }
    }

    // Scenario 2: Selected Component Inspector
    const selectedComp = this.selectedComponentId ? this.circuit.components[this.selectedComponentId] : null;
    if (!selectedComp) {
      inspector.createDiv({
        cls: "goodobsidian-blocks-empty",
        text: "Select a component or wire to inspect properties.",
      });
      return;
    }

    const def = COMPONENT_CATALOG[selectedComp.type];

    if (selectedComp.type === "text_label") {
      inspector.createEl("h3", { text: `Properties: ${selectedComp.label}` });
      const labelGroup = inspector.createDiv({ cls: "setting-item" });
      labelGroup.createDiv({ cls: "setting-item-name", text: "Text / LaTeX (e.g. + , - , Vo , 15V , \\infty)" });
      const labelInput = labelGroup.createEl("input", { type: "text", value: selectedComp.label });
      labelInput.placeholder = "Enter label text";
      labelInput.onchange = () => {
        this.mutateCircuit((c) => {
          const comp = c.components[selectedComp.id];
          if (comp) comp.label = labelInput.value.trim() || "Label";
        });
      };
      labelInput.onkeydown = (e) => e.stopPropagation();

      const deleteBtn = inspector.createEl("button", {
        text: "Delete Label",
        cls: "goodobsidian-circuit-btn mod-warning goodobsidian-delete-btn",
      });
      deleteBtn.onclick = () => this.deleteComponent(selectedComp.id);
      return;
    }

    inspector.createEl("h3", { text: `Properties: ${selectedComp.label}` });
    if (Object.keys(selectedComp.ports).some((id) => !def?.ports.some((port) => port.id === id))) {
      const repair = inspector.createEl("button", { text: "Reset invalid terminals", cls: "goodobsidian-circuit-btn" });
      repair.onclick = () => {
        this.mutateCircuit((c) => changeComponentType(c, selectedComp.id, selectedComp.type));
        new Notice("Invalid terminal names removed. Check and reconnect the terminals below.");
      };
    }

    // Component Type
    const typeGroup = inspector.createDiv({ cls: "setting-item" });
    typeGroup.createDiv({ cls: "setting-item-name", text: "Component Type" });
    const typeSelect = typeGroup.createEl("select", { cls: "goodobsidian-circuit-select" });
    for (const [t, d] of Object.entries(COMPONENT_CATALOG)) {
      const opt = typeSelect.createEl("option", { text: d.description, value: t });
      if (t === selectedComp.type) opt.selected = true;
    }
    typeSelect.onchange = () => {
      const nextType = typeSelect.value as ComponentType;
      this.mutateCircuit((c) => {
        const comp = c.components[selectedComp.id];
        if (!comp) return;
        changeComponentType(c, comp.id, nextType);
      });
    };

    // Label
    const labelGroup = inspector.createDiv({ cls: "setting-item" });
    labelGroup.createDiv({ cls: "setting-item-name", text: "Label (e.g. R1, C1)" });
    const labelInput = labelGroup.createEl("input", { type: "text", value: selectedComp.label });
    labelInput.onchange = () => {
      this.mutateCircuit((c) => {
        const comp = c.components[selectedComp.id];
        if (comp) comp.label = labelInput.value.trim();
      });
    };
    labelInput.onkeydown = (e) => e.stopPropagation();

    // Value
    const valueGroup = inspector.createDiv({ cls: "setting-item" });
    valueGroup.createDiv({ cls: "setting-item-name", text: "Value (e.g. 10kΩ, 100nF, 5V)" });
    const valueInput = valueGroup.createEl("input", { type: "text", value: selectedComp.value || "" });
    valueInput.onchange = () => {
      this.mutateCircuit((c) => {
        const comp = c.components[selectedComp.id];
        if (comp) comp.value = valueInput.value.trim() || undefined;
      });
    };
    valueInput.onkeydown = (e) => e.stopPropagation();

    // Rotation (Exact degree assignment)
    const rotGroup = inspector.createDiv({ cls: "setting-item" });
    rotGroup.createDiv({ cls: "setting-item-name", text: "Rotation" });
    const rotSelect = rotGroup.createEl("select", { cls: "goodobsidian-circuit-select" });
    for (const deg of [0, 90, 180, 270]) {
      const opt = rotSelect.createEl("option", { text: `${deg}°`, value: `${deg}` });
      if (deg === selectedComp.rotation) opt.selected = true;
    }
    rotSelect.onchange = () => {
      const targetDeg = parseInt(rotSelect.value, 10);
      this.rotateComponent(selectedComp.id, targetDeg);
    };

    // Mirror toggle
    const mirrorGroup = inspector.createDiv({ cls: "setting-item" });
    mirrorGroup.createDiv({ cls: "setting-item-name", text: "Mirror Horizontally" });
    const mirrorCheckbox = mirrorGroup.createEl("input", { type: "checkbox" });
    mirrorCheckbox.checked = Boolean(selectedComp.mirror);
    mirrorCheckbox.onchange = () => {
      this.mutateCircuit((c) => {
        const comp = c.components[selectedComp.id];
        if (comp) comp.mirror = mirrorCheckbox.checked;
      });
    };

    // Reset Label Placement if manually adjusted
    if (selectedComp.labelOffset?.manual || selectedComp.valueOffset?.manual) {
      const resetLabelGroup = inspector.createDiv({ cls: "setting-item" });
      resetLabelGroup.createDiv({ cls: "setting-item-name", text: "Label Position" });
      const resetLabelBtn = resetLabelGroup.createEl("button", {
        text: "Reset Label to Auto Position",
        cls: "goodobsidian-circuit-btn",
      });
      resetLabelBtn.onclick = () => {
        this.mutateCircuit((c) => {
          const comp = c.components[selectedComp.id];
          if (comp) {
            comp.labelOffset = undefined;
            comp.valueOffset = undefined;
          }
        });
        new Notice("Label positions reset to automatic.");
      };
    }

    // Terminals & Connections
    inspector.createEl("h4", { text: "Terminals & Node Connections" });
    const portsList = inspector.createDiv({ cls: "goodobsidian-ports-list" });

    if (def) {
      for (const port of def.ports) {
        const portItem = portsList.createDiv({ cls: "goodobsidian-port-item" });
        portItem.createSpan({ cls: "goodobsidian-port-name", text: `Terminal ${port.name}:` });

        const nodeSelect = portItem.createEl("select", { cls: "goodobsidian-circuit-select" });
        const currentNodeId = selectedComp.ports[port.id];

        for (const node of Object.values(this.circuit.nodes)) {
          const opt = nodeSelect.createEl("option", {
            text: this.nodeDisplayName(node.id),
            value: node.id,
          });
          if (node.id === currentNodeId) opt.selected = true;
        }

        nodeSelect.createEl("option", { text: "Not connected", value: "" });
        nodeSelect.value = currentNodeId || "";

        nodeSelect.onchange = () => {
          const targetNodeId = nodeSelect.value;
          this.mutateCircuit((c) => {
            const comp = c.components[selectedComp.id];
            if (comp) {
              if (targetNodeId) comp.ports[port.id] = targetNodeId;
              else delete comp.ports[port.id];
            }
          });
        };
      }
    }

    // Delete Component Action
    const deleteBtn = inspector.createEl("button", {
      text: "Delete Component",
      cls: "goodobsidian-circuit-btn mod-warning goodobsidian-delete-btn",
    });
    deleteBtn.onclick = () => this.deleteComponent(selectedComp.id);
  }

  // --- View C: Code Editor -------------------------------------------------

  private renderCodeView(): void {
    this.codeViewEl.empty();

    const toolbar = this.codeViewEl.createDiv({ cls: "goodobsidian-circuit-toolbar" });

    const copyBtn = toolbar.createEl("button", {
      cls: "goodobsidian-circuit-btn",
      text: "Copy CircuitikZ",
    });
    copyBtn.onclick = async () => {
      if (this.codeTextareaEl) {
        await navigator.clipboard.writeText(this.codeTextareaEl.value);
        new Notice("CircuitikZ code copied to clipboard!");
      }
    };

    const reformatBtn = toolbar.createEl("button", {
      cls: "goodobsidian-circuit-btn",
      text: "Regenerate from Circuit",
    });
    reformatBtn.onclick = () => {
      this.codeDraft = circuitToTikz(this.circuit);
      this.codeDraftDirty = false;
      this.codeDiagnostics = [];
      if (this.codeTextareaEl) this.codeTextareaEl.value = this.codeDraft;
      this.renderDiagnostics();
    };

    const editorWrapper = this.codeViewEl.createDiv({ cls: "goodobsidian-code-wrapper" });
    this.codeTextareaEl = editorWrapper.createEl("textarea", {
      cls: "goodobsidian-code-textarea",
    });
    this.codeTextareaEl.value = this.codeDraft;
    this.codeTextareaEl.spellcheck = false;

    this.codeTextareaEl.oninput = () => {
      if (!this.codeTextareaEl) return;
      this.codeDraft = this.codeTextareaEl.value;
      this.codeDraftDirty = true;
      this.scheduleCodeParse();
    };

    this.diagnosticsEl = this.codeViewEl.createDiv({ cls: "goodobsidian-code-diagnostics" });
    this.renderDiagnostics();
  }

  private scheduleCodeParse(): void {
    if (this.parseDebounceTimer !== null) {
      window.clearTimeout(this.parseDebounceTimer);
    }
    this.parseDebounceTimer = window.setTimeout(() => {
      this.flushCodeParse();
    }, 400);
  }

  private flushCodeParse(): void {
    if (this.parseDebounceTimer !== null) {
      window.clearTimeout(this.parseDebounceTimer);
      this.parseDebounceTimer = null;
    }

    const result = tikzToCircuit(this.codeDraft);
    this.codeDiagnostics = result.diagnostics;

    const hasErrors = result.diagnostics.some((d) => d.severity === "error");
    if (!hasErrors) {
      const prevTikz = circuitToTikz(this.circuit);
      const nextTikz = circuitToTikz(result.circuit);
      if (prevTikz !== nextTikz) {
        this.pushHistory(this.circuit);
      }
      result.circuit.uncertainties = this.circuit.uncertainties;
      this.circuit = result.circuit;
      materializeCircuitGeometry(this.circuit);
      this.refreshElectricalDiagnostics();
      this.renderReviewIssues();
      this.codeDraftDirty = false;
    }

    this.renderDiagnostics();
  }

  private renderDiagnostics(): void {
    if (!this.diagnosticsEl) return;
    this.diagnosticsEl.empty();

    if (this.codeDiagnostics.length === 0) {
      const validMsg = this.diagnosticsEl.createDiv({ cls: "goodobsidian-diagnostic is-ok" });
      validMsg.setText("✓ Valid CircuitikZ syntax");
      return;
    }

    for (const diag of this.codeDiagnostics) {
      const item = this.diagnosticsEl.createDiv({
        cls: `goodobsidian-diagnostic is-${diag.severity}`,
      });
      item.setText(`Line ${diag.line}: ${diag.message}`);
    }
  }

  private renderWireEndpoint(parent: HTMLElement, wireId: string, endpoint: "fromNode" | "toNode"): void {
    const wire = this.circuit.wires.find((w) => w.id === wireId);
    if (!wire) return;
    const select = parent.createEl("select", { cls: "goodobsidian-circuit-select" });
    for (const node of Object.values(this.circuit.nodes)) {
      select.createEl("option", { text: this.nodeDisplayName(node.id), value: node.id });
    }
    select.value = wire[endpoint];
    select.onchange = () => {
      const nodeId = select.value;
      const other = endpoint === "fromNode" ? wire.toNode : wire.fromNode;
      if (nodeId === other) {
        select.value = wire[endpoint];
        new Notice("Choose a different destination terminal.");
        return;
      }
      this.mutateCircuit((c) => {
        const edited = c.wires.find((w) => w.id === wireId);
        if (!edited) return;
        edited[endpoint] = nodeId;
        edited.waypoints = undefined;
        const routed = rerouteCircuitWires(c, [wireId]);
        c.wires = routed.wires;
      });
    };
  }

  private nodeDisplayName(id: string): string {
    const node = this.circuit.nodes[id];
    if (node?.label) return node.label;
    const pins: string[] = [];
    for (const comp of Object.values(this.circuit.components)) {
      for (const [portId, nodeId] of Object.entries(comp.ports)) {
        if (nodeId !== id) continue;
        const port = COMPONENT_CATALOG[comp.type]?.ports.find((p) => p.id === portId);
        pins.push(`${comp.label} · ${port?.name || portId}`);
      }
    }
    return pins.length ? pins.join(" / ") : `Junction ${Object.keys(this.circuit.nodes).indexOf(id) + 1}`;
  }

  private refreshElectricalDiagnostics(): void {
    const recognitionNotes = (this.circuit.diagnostics || []).filter((d) => d.code === "NORMALIZATION_REPAIR");
    this.circuit.diagnostics = [...recognitionNotes, ...validateCircuitConnectivity(this.circuit)];
  }

  private renderReviewIssues(): void {
    if (!this.reviewIssuesEl) return;
    const wasOpen = this.reviewIssuesEl.querySelector("details")?.open;
    this.reviewIssuesEl.empty();
    const diagnostics = (this.circuit.diagnostics || []).filter((d) => d.severity !== "info");
    const uncertainties = this.circuit.uncertainties || [];
    const count = diagnostics.length + uncertainties.length;
    if (!count) {
      this.reviewIssuesEl.createSpan({ text: "No connection warnings." });
      return;
    }
    const details = this.reviewIssuesEl.createEl("details");
    details.open = wasOpen ?? false;
    details.createEl("summary", { text: `${count} item${count === 1 ? "" : "s"} to check` });
    const list = details.createDiv({ cls: "goodobsidian-circuit-issue-list" });
    uncertainties.forEach((text, index) => {
      const row = list.createDiv({ cls: "goodobsidian-circuit-issue" });
      row.createSpan({ text: `AI uncertainty: ${text}` });
      const resolve = row.createEl("button", { text: "Resolved", cls: "goodobsidian-circuit-btn" });
      resolve.onclick = () => this.mutateCircuit((c) => { c.uncertainties?.splice(index, 1); });
    });
    for (const diagnostic of diagnostics) {
      const row = list.createDiv({ cls: `goodobsidian-circuit-issue is-${diagnostic.severity}` });
      row.createSpan({ text: diagnostic.message });
      if (diagnostic.componentId || diagnostic.wireId || diagnostic.nodeId) {
        const inspect = row.createEl("button", { text: "Inspect", cls: "goodobsidian-circuit-btn" });
        inspect.onclick = () => {
          this.selectedComponentId = diagnostic.componentId || null;
          this.selectedWireId = diagnostic.componentId ? null : diagnostic.wireId || null;
          this.selectedNodeId = diagnostic.componentId || diagnostic.wireId ? null : diagnostic.nodeId || null;
          this.switchTab("visual");
        };
      }
    }
  }

  // --- Save / Commit -------------------------------------------------------

  private handleSave(): void {
    if (this.activeTab === "code" && this.codeDraftDirty) {
      this.flushCodeParse();
    }

    this.finishActiveDrag();
    this.refreshElectricalDiagnostics();
    this.renderReviewIssues();
    const hasErrors = this.codeDiagnostics.some((d) => d.severity === "error") ||
      (this.circuit.diagnostics || []).some((d) => d.severity === "error" || d.code === "INVALID_PORT");
    if (hasErrors) {
      new Notice(this.codeDraftDirty
        ? "Saving the current diagram. Invalid CircuitikZ edits were not applied."
        : "Saving circuit with validation warnings.");
    }

    const tikz = circuitToTikz(this.circuit);
    const svg = renderCircuitToSvg(this.circuit, {
      theme: "light",
      backgroundColor: "transparent",
    });

    this.onSave(this.circuit, tikz, svg);
    this.close();
  }
}

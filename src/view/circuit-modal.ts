/**
 * Interactive 3-View Circuit Editor Modal for FineNotes.
 *
 * Exposes Visual, Blocks/Properties, and CircuitikZ Code views synchronized
 * via a single canonical Kirchhoff IR transaction layer with draft revisions
 * and error diagnostics.
 */

import { type App, Modal, Notice, setIcon } from "obsidian";
import {
  type CircuitComponent,
  type ComponentType,
  COMPONENT_CATALOG,
  type KirchhoffCircuit,
  cloneCircuit,
  getComponentPortPosition,
} from "../circuit/ir";
import { circuitToTikz, tikzToCircuit } from "../circuit/ir2tikz";
import { renderCircuitToSvg } from "../circuit/svg-render";

export type CircuitEditorTab = "visual" | "blocks" | "code";

export interface CircuitModalOptions {
  circuit: KirchhoffCircuit;
  onSave: (circuit: KirchhoffCircuit, tikz: string, svg: string) => void;
  onCancel?: () => void;
}

export class CircuitModal extends Modal {
  private circuit: KirchhoffCircuit;
  private readonly onSave: CircuitModalOptions["onSave"];
  private readonly onCancel?: CircuitModalOptions["onCancel"];

  // State Store
  private activeTab: CircuitEditorTab = "visual";
  private selectedComponentId: string | null = null;
  private selectedNodeId: string | null = null;

  // Code draft & revision tracking
  private codeDraft: string = "";
  private codeDraftDirty: boolean = false;
  private codeDiagnostics: Array<{ line: number; message: string; severity: "error" | "warning" }> = [];
  private parseDebounceTimer: number | null = null;

  // Visual interaction state
  private draggingCompId: string | null = null;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };

  // DOM containers
  private tabHeaderEl!: HTMLElement;
  private bodyContainerEl!: HTMLElement;
  private visualViewEl!: HTMLElement;
  private blocksViewEl!: HTMLElement;
  private codeViewEl!: HTMLElement;
  private codeTextareaEl?: HTMLTextAreaElement;
  private diagnosticsEl?: HTMLElement;

  constructor(app: App, options: CircuitModalOptions) {
    super(app);
    this.circuit = cloneCircuit(options.circuit);
    this.onSave = options.onSave;
    this.onCancel = options.onCancel;
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

    // Header with title and tabs
    const headerEl = contentEl.createDiv({ cls: "goodobsidian-circuit-header" });
    const titleEl = headerEl.createDiv({ cls: "goodobsidian-circuit-title" });
    titleEl.createEl("h2", { text: "Circuit Editor" });

    this.tabHeaderEl = headerEl.createDiv({ cls: "goodobsidian-circuit-tabs" });
    this.buildTabButtons();

    const actionsEl = headerEl.createDiv({ cls: "goodobsidian-circuit-header-actions" });
    const cancelBtn = actionsEl.createEl("button", { text: "Cancel", cls: "mod-cancel" });
    cancelBtn.onclick = () => {
      this.onCancel?.();
      this.close();
    };

    const saveBtn = actionsEl.createEl("button", { text: "Save Circuit", cls: "mod-cta" });
    saveBtn.onclick = () => this.handleSave();

    // Body
    this.bodyContainerEl = contentEl.createDiv({ cls: "goodobsidian-circuit-body" });

    this.visualViewEl = this.bodyContainerEl.createDiv({ cls: "goodobsidian-circuit-view is-visual" });
    this.blocksViewEl = this.bodyContainerEl.createDiv({ cls: "goodobsidian-circuit-view is-blocks is-hidden" });
    this.codeViewEl = this.bodyContainerEl.createDiv({ cls: "goodobsidian-circuit-view is-code is-hidden" });

    this.renderVisualView();
    this.renderBlocksView();
    this.renderCodeView();
    this.switchTab(this.activeTab);
  }

  override onClose(): void {
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
      { id: "blocks", label: "Properties", icon: "sliders" },
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
    // If switching away from dirty code view, flush parse
    if (this.activeTab === "code" && tab !== "code" && this.codeDraftDirty) {
      this.flushCodeParse();
    }

    this.activeTab = tab;
    this.buildTabButtons();

    this.visualViewEl.toggleClass("is-hidden", tab !== "visual");
    this.blocksViewEl.toggleClass("is-hidden", tab !== "blocks");
    this.codeViewEl.toggleClass("is-hidden", tab !== "code");

    if (tab === "visual") {
      this.renderVisualView();
    } else if (tab === "blocks") {
      this.renderBlocksView();
    } else if (tab === "code") {
      if (!this.codeDraftDirty) {
        this.codeDraft = circuitToTikz(this.circuit);
        if (this.codeTextareaEl) {
          this.codeTextareaEl.value = this.codeDraft;
        }
      }
    }
  }

  // --- Central Transaction & Mutation Helpers -----------------------------

  private mutateCircuit(fn: (c: KirchhoffCircuit) => void): void {
    const next = cloneCircuit(this.circuit);
    fn(next);
    this.circuit = next;

    // Invalidate and regenerate code draft
    this.codeDraft = circuitToTikz(this.circuit);
    this.codeDraftDirty = false;
    this.codeDiagnostics = [];

    if (this.codeTextareaEl) {
      this.codeTextareaEl.value = this.codeDraft;
    }

    // Refresh active view
    if (this.activeTab === "visual") this.renderVisualView();
    else if (this.activeTab === "blocks") this.renderBlocksView();
  }

  // --- View A: Visual Editor ----------------------------------------------

  private renderVisualView(): void {
    this.visualViewEl.empty();

    // Visual toolbar
    const toolbar = this.visualViewEl.createDiv({ cls: "goodobsidian-visual-toolbar" });

    // Component add dropdown / palette
    const addSelect = toolbar.createEl("select", { cls: "dropdown" });
    addSelect.createEl("option", { text: "+ Add Component...", value: "" });
    for (const [type, def] of Object.entries(COMPONENT_CATALOG)) {
      addSelect.createEl("option", { text: `${def.description} (${def.labelPrefix})`, value: type });
    }
    addSelect.onchange = () => {
      const type = addSelect.value as ComponentType;
      if (type) {
        this.addComponent(type);
        addSelect.value = "";
      }
    };

    if (this.selectedComponentId && this.circuit.components[this.selectedComponentId]) {
      const rotBtn = toolbar.createEl("button", { text: "Rotate 90°" });
      rotBtn.onclick = () => {
        if (!this.selectedComponentId) return;
        this.rotateComponent(this.selectedComponentId);
      };

      const delBtn = toolbar.createEl("button", { text: "Delete", cls: "mod-warning" });
      delBtn.onclick = () => {
        if (!this.selectedComponentId) return;
        this.deleteComponent(this.selectedComponentId);
      };
    }

    // Canvas/SVG container
    const stage = this.visualViewEl.createDiv({ cls: "goodobsidian-visual-stage" });

    const svgMarkup = renderCircuitToSvg(this.circuit, {
      theme: "light",
      showGrid: true,
      showNodes: true,
      showPorts: true,
      highlightComponentId: this.selectedComponentId ?? undefined,
      highlightNodeId: this.selectedNodeId ?? undefined,
      padding: 40,
    });

    stage.innerHTML = svgMarkup;

    // Attach interactive SVG event handlers
    const svgEl = stage.querySelector("svg");
    if (svgEl) {
      svgEl.style.width = "100%";
      svgEl.style.height = "100%";
      svgEl.style.cursor = "default";

      svgEl.onpointerdown = (ev) => this.handleStagePointerDown(ev, svgEl);
      svgEl.onpointermove = (ev) => this.handleStagePointerMove(ev, svgEl);
      svgEl.onpointerup = () => this.handleStagePointerUp();
    }
  }

  private handleStagePointerDown(ev: PointerEvent, svgEl: SVGSVGElement): void {
    const pt = this.svgPoint(ev, svgEl);
    const gridSize = this.circuit.gridSize || 20;
    const gridX = pt.x / gridSize;
    const gridY = pt.y / gridSize;

    // Check hit on components
    for (const comp of Object.values(this.circuit.components)) {
      const def = COMPONENT_CATALOG[comp.type];
      const hw = (def ? def.width : 2) / 2;
      const hh = (def ? def.height : 2) / 2;

      if (
        gridX >= comp.x - hw &&
        gridX <= comp.x + hw &&
        gridY >= comp.y - hh &&
        gridY <= comp.y + hh
      ) {
        this.selectedComponentId = comp.id;
        this.selectedNodeId = null;
        this.draggingCompId = comp.id;
        this.dragOffset = { x: gridX - comp.x, y: gridY - comp.y };
        this.renderVisualView();
        return;
      }
    }

    // Check hit on nodes
    for (const node of Object.values(this.circuit.nodes)) {
      const dist = Math.hypot(gridX - node.x, gridY - node.y);
      if (dist < 0.6) {
        this.selectedNodeId = node.id;
        this.selectedComponentId = null;
        this.renderVisualView();
        return;
      }
    }

    // Deselect if clicked blank area
    this.selectedComponentId = null;
    this.selectedNodeId = null;
    this.renderVisualView();
  }

  private handleStagePointerMove(ev: PointerEvent, svgEl: SVGSVGElement): void {
    if (!this.draggingCompId) return;
    const pt = this.svgPoint(ev, svgEl);
    const gridSize = this.circuit.gridSize || 20;
    const rawGridX = pt.x / gridSize - this.dragOffset.x;
    const rawGridY = pt.y / gridSize - this.dragOffset.y;

    // Snap to 0.5 grid units
    const snappedX = Math.round(rawGridX * 2) / 2;
    const snappedY = Math.round(rawGridY * 2) / 2;

    const comp = this.circuit.components[this.draggingCompId];
    if (comp && (comp.x !== snappedX || comp.y !== snappedY)) {
      comp.x = snappedX;
      comp.y = snappedY;

      // Also translate connected nodes that are dedicated to this component's ports
      for (const [pId, nId] of Object.entries(comp.ports)) {
        const node = this.circuit.nodes[nId];
        if (node) {
          const portPos = getComponentPortPosition(comp, pId);
          if (portPos) {
            node.x = portPos.x;
            node.y = portPos.y;
          }
        }
      }

      this.renderVisualView();
    }
  }

  private handleStagePointerUp(): void {
    if (this.draggingCompId) {
      this.draggingCompId = null;
      // Commit update
      this.mutateCircuit(() => {});
    }
  }

  private svgPoint(ev: PointerEvent, svgEl: SVGSVGElement): { x: number; y: number } {
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

  private addComponent(type: ComponentType): void {
    const def = COMPONENT_CATALOG[type];
    const prefix = def?.labelPrefix || "C";

    // Mint ID and label
    let counter = 1;
    while (this.circuit.components[`${prefix.toLowerCase()}${counter}`]) {
      counter++;
    }
    const id = `${prefix.toLowerCase()}${counter}`;
    const label = `${prefix}${counter}`;

    // Place near center or offset from existing
    let cx = 0;
    let cy = 0;
    const compCount = Object.keys(this.circuit.components).length;
    if (compCount > 0) {
      cx = (compCount % 4) * 4;
      cy = Math.floor(compCount / 4) * 4;
    }

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

      // Create nodes for each port
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
    });

    this.selectedComponentId = id;
    if (this.activeTab === "visual") this.renderVisualView();
  }

  private rotateComponent(compId: string): void {
    this.mutateCircuit((c) => {
      const comp = c.components[compId];
      if (!comp) return;
      comp.rotation = (comp.rotation + 90) % 360;

      // Update connected port nodes
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
    this.mutateCircuit((c) => {
      const comp = c.components[compId];
      if (!comp) return;

      // Delete component's dedicated nodes if not connected to other components
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

    this.selectedComponentId = null;
    if (this.activeTab === "visual") this.renderVisualView();
  }

  // --- View B: Blocks / Properties Editor ----------------------------------

  private renderBlocksView(): void {
    this.blocksViewEl.empty();
    const container = this.blocksViewEl.createDiv({ cls: "goodobsidian-blocks-container" });

    // Left side: Component list
    const sidebar = container.createDiv({ cls: "goodobsidian-blocks-sidebar" });
    sidebar.createEl("h4", { text: "Components" });

    const compList = sidebar.createDiv({ cls: "goodobsidian-blocks-list" });
    for (const comp of Object.values(this.circuit.components)) {
      const def = COMPONENT_CATALOG[comp.type];
      const item = compList.createDiv({
        cls: `goodobsidian-blocks-item ${this.selectedComponentId === comp.id ? "is-selected" : ""}`,
      });
      item.createSpan({ cls: "goodobsidian-comp-label", text: comp.label });
      item.createSpan({ cls: "goodobsidian-comp-type", text: def?.description || comp.type });
      if (comp.value) {
        item.createSpan({ cls: "goodobsidian-comp-val", text: comp.value });
      }
      item.onclick = () => {
        this.selectedComponentId = comp.id;
        this.renderBlocksView();
      };
    }

    const addBtn = sidebar.createEl("button", { text: "+ Add Component", cls: "goodobsidian-add-comp-btn" });
    addBtn.onclick = () => this.addComponent("resistor");

    // Right side: Properties inspector for selected component
    const inspector = container.createDiv({ cls: "goodobsidian-blocks-inspector" });
    const selectedComp = this.selectedComponentId ? this.circuit.components[this.selectedComponentId] : null;

    if (!selectedComp) {
      inspector.createDiv({ cls: "goodobsidian-blocks-empty", text: "Select a component to inspect properties." });
      return;
    }

    const def = COMPONENT_CATALOG[selectedComp.type];

    inspector.createEl("h3", { text: `Properties: ${selectedComp.label}` });

    // Component Type
    const typeGroup = inspector.createDiv({ cls: "setting-item" });
    typeGroup.createDiv({ cls: "setting-item-name", text: "Component Type" });
    const typeSelect = typeGroup.createEl("select", { cls: "dropdown" });
    for (const [t, d] of Object.entries(COMPONENT_CATALOG)) {
      const opt = typeSelect.createEl("option", { text: d.description, value: t });
      if (t === selectedComp.type) opt.selected = true;
    }
    typeSelect.onchange = () => {
      const nextType = typeSelect.value as ComponentType;
      this.mutateCircuit((c) => {
        const comp = c.components[selectedComp.id];
        if (!comp) return;
        comp.type = nextType;
        const newDef = COMPONENT_CATALOG[nextType];
        if (newDef?.defaultValue && !comp.value) {
          comp.value = newDef.defaultValue;
        }
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

    // Orientation / Rotation
    const rotGroup = inspector.createDiv({ cls: "setting-item" });
    rotGroup.createDiv({ cls: "setting-item-name", text: "Rotation" });
    const rotSelect = rotGroup.createEl("select", { cls: "dropdown" });
    for (const deg of [0, 90, 180, 270]) {
      const opt = rotSelect.createEl("option", { text: `${deg}°`, value: `${deg}` });
      if (deg === selectedComp.rotation) opt.selected = true;
    }
    rotSelect.onchange = () => {
      this.rotateComponent(selectedComp.id);
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

    // Ports / Terminals
    inspector.createEl("h4", { text: "Terminals & Node Connections" });
    const portsList = inspector.createDiv({ cls: "goodobsidian-ports-list" });

    if (def) {
      for (const port of def.ports) {
        const portItem = portsList.createDiv({ cls: "goodobsidian-port-item" });
        portItem.createSpan({ cls: "goodobsidian-port-name", text: `Terminal ${port.name}:` });

        const nodeSelect = portItem.createEl("select", { cls: "dropdown" });
        const currentNodeId = selectedComp.ports[port.id];

        for (const node of Object.values(this.circuit.nodes)) {
          const opt = nodeSelect.createEl("option", {
            text: node.label ? `${node.label} (${node.id})` : node.id,
            value: node.id,
          });
          if (node.id === currentNodeId) opt.selected = true;
        }

        nodeSelect.onchange = () => {
          const targetNodeId = nodeSelect.value;
          this.mutateCircuit((c) => {
            const comp = c.components[selectedComp.id];
            if (comp) comp.ports[port.id] = targetNodeId;
          });
        };
      }
    }

    // Delete Component Action
    const deleteBtn = inspector.createEl("button", {
      text: "Delete Component",
      cls: "mod-warning goodobsidian-delete-btn",
    });
    deleteBtn.onclick = () => this.deleteComponent(selectedComp.id);
  }

  // --- View C: Code Editor -------------------------------------------------

  private renderCodeView(): void {
    this.codeViewEl.empty();

    const toolbar = this.codeViewEl.createDiv({ cls: "goodobsidian-code-toolbar" });

    const copyBtn = toolbar.createEl("button", { text: "Copy CircuitikZ" });
    copyBtn.onclick = async () => {
      if (this.codeTextareaEl) {
        await navigator.clipboard.writeText(this.codeTextareaEl.value);
        new Notice("CircuitikZ code copied to clipboard!");
      }
    };

    const reformatBtn = toolbar.createEl("button", { text: "Regenerate from Circuit" });
    reformatBtn.onclick = () => {
      this.codeDraft = circuitToTikz(this.circuit);
      this.codeDraftDirty = false;
      this.codeDiagnostics = [];
      if (this.codeTextareaEl) this.codeTextareaEl.value = this.codeDraft;
      this.renderDiagnostics();
    };

    // Editor textarea
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

    // Diagnostics container
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

    // Check if valid
    const hasErrors = result.diagnostics.some((d) => d.severity === "error");
    if (!hasErrors) {
      this.circuit = result.circuit;
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

  // --- Save / Commit -------------------------------------------------------

  private handleSave(): void {
    if (this.activeTab === "code" && this.codeDraftDirty) {
      this.flushCodeParse();
    }

    const tikz = this.codeDraft || circuitToTikz(this.circuit);
    const svg = renderCircuitToSvg(this.circuit, {
      theme: "light",
      backgroundColor: "transparent",
    });

    this.onSave(this.circuit, tikz, svg);
    this.close();
  }
}

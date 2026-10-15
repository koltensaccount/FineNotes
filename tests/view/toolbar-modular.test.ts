import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/thickness-editor", () => ({
  renderThicknessEditor: vi.fn(() => Object.assign(() => {}, { dispose: () => {} })),
}));

class MockEl {
  children: MockEl[] = [];
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  text = "";
  disabled = false;
  parentElement: MockEl | null = null;
  style: Record<string, string> = {};
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  ownerDocument!: MockDoc;

  get className(): string {
    return Array.from(this.classes).join(" ");
  }

  set className(val: string) {
    this.classes.clear();
    val.split(" ").filter(Boolean).forEach((c) => this.classes.add(c));
  }

  constructor(readonly tag = "div") {}

  createEl(
    tag: string,
    o: { cls?: string; text?: string; attr?: Record<string, string>; type?: string } = {},
  ): MockEl {
    const e = new MockEl(tag);
    e.text = o.text ?? "";
    e.attrs = { ...o.attr };
    if (o.cls) o.cls.split(" ").filter(Boolean).forEach((c) => e.classes.add(c));
    e.ownerDocument = this.ownerDocument;
    e.parentElement = this;
    this.children.push(e);
    return e;
  }

  createDiv(o = {}): MockEl {
    return this.createEl("div", o);
  }

  createSpan(o = {}): MockEl {
    return this.createEl("span", o);
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
    if (k.startsWith("data-")) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = v;
    }
  }

  setAttr(k: string, v: string): void {
    this.setAttribute(k, v);
  }

  getAttribute(k: string): string | undefined {
    return this.attrs[k];
  }

  removeAttribute(k: string): void {
    delete this.attrs[k];
    if (k.startsWith("data-")) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[prop];
    }
  }

  setText(s: string): void {
    this.text = s;
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }

  setCssStyles(s: Record<string, string>): void {
    Object.assign(this.style, s);
  }
  setCssProps(_s: Record<string, string>): void {}

  empty(): void {
    this.children = [];
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  cloneNode(deep = false): MockEl {
    const clone = new MockEl(this.tag);
    clone.ownerDocument = this.ownerDocument;
    clone.attrs = { ...this.attrs }; clone.dataset = { ...this.dataset };
    clone.classes = new Set(this.classes); clone.style = { ...this.style };
    clone.text = this.text;
    if (deep) for (const child of this.children) clone.append(child.cloneNode(true));
    return clone;
  }

  append(...e: MockEl[]): void {
    for (const child of e) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  appendChild(child: MockEl): MockEl {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: MockEl, ref: MockEl | null): MockEl {
    child.remove();
    child.parentElement = this;
    if (!ref) {
      this.children.push(child);
    } else {
      const idx = this.children.indexOf(ref);
      if (idx === -1) this.children.push(child);
      else this.children.splice(idx, 0, child);
    }
    return child;
  }

  addClass(...c: string[]): void {
    c.forEach((v) => this.classes.add(v));
  }

  removeClass(...c: string[]): void {
    c.forEach((v) => this.classes.delete(v));
  }

  hasClass(c: string): boolean {
    return this.classes.has(c);
  }

  toggleClass(c: string, on: boolean): void {
    if (on) this.classes.add(c);
    else this.classes.delete(c);
  }

  closest(selector: string): MockEl | null {
    if (selector === "button" && this.tag === "button") return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  addEventListener(n: string, f: (...args: any[]) => void): void {
    const arr = this.handlers.get(n) ?? [];
    arr.push(f);
    this.handlers.set(n, arr);
  }

  removeEventListener(n: string, f: (...args: any[]) => void): void {
    const arr = this.handlers.get(n);
    if (!arr) return;
    const idx = arr.indexOf(f);
    if (idx !== -1) arr.splice(idx, 1);
  }

  dispatchEvent(name: string, eventData: any = {}): void {
    const arr = this.handlers.get(name);
    if (arr) {
      for (const fn of [...arr]) fn(eventData);
    }
  }

  click(): void {
    this.dispatchEvent("click", {});
  }

  get nextElementSibling(): MockEl | null {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx >= 0 && idx < this.parentElement.children.length - 1
      ? this.parentElement.children[idx + 1]
      : null;
  }

  get previousElementSibling(): MockEl | null {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx > 0 ? this.parentElement.children[idx - 1] : null;
  }

  get lastElementChild(): MockEl | null {
    return this.children.length > 0 ? this.children[this.children.length - 1] : null;
  }

  isFocused = false;
  focus(): void {
    this.isFocused = true;
  }

  getBoundingClientRect(): DOMRect {
    let left = 10;
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      left = 10 + (idx >= 0 ? idx : 0) * 50;
    }
    return {
      left,
      right: left + 40,
      top: 10,
      bottom: 50,
      width: 40,
      height: 40,
      x: left,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect;
  }

  setPointerCapture(_id: number): void {}
  releasePointerCapture(_id: number): void {}

  querySelector(selector: string): MockEl | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockEl[] {
    const result: MockEl[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  matches(selector: string): boolean {
    if (selector.startsWith(".")) {
      const classes = selector.split(".").filter(Boolean);
      return classes.every((c) => this.classes.has(c));
    }
    const attrMatch = selector.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
    if (attrMatch) {
      const [, attr, val] = attrMatch;
      if (attr.startsWith("data-")) {
        const prop = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return this.dataset[prop] === val;
      }
      return this.attrs[attr] === val;
    }
    return this.tag === selector;
  }

  instanceOf(_cls: any): boolean {
    return true;
  }

  animate(_keyframes: any, _options: any): any {
    return {
      cancel: () => {},
      finish: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  contains(other: MockEl): boolean {
    if (this === other) return true;
    return this.children.some((c) => c.contains(other));
  }
}

globalThis.HTMLElement = MockEl as any;
globalThis.getComputedStyle = (() => ({
  backgroundColor: "#ffffff",
  getPropertyValue: () => "",
})) as any;

class MockDoc {
  body: MockEl;
  documentElement: MockEl;
  defaultView = {
    innerWidth: 1000, innerHeight: 800,
    visualViewport: {
      offsetLeft: 0,
      offsetTop: 0,
      width: 1000,
      height: 800,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    getComputedStyle: () => ({ backgroundColor: "#ffffff" }),
    addEventListener: () => {},
    removeEventListener: () => {},
    clearTimeout: () => {},
    setTimeout: () => 1,
  };
  handlers = new Map<string, Array<(...args: any[]) => void>>();

  constructor() {
    this.body = new MockEl("body");
    this.body.ownerDocument = this;
    this.documentElement = new MockEl("html");
    this.documentElement.ownerDocument = this;
    (this.documentElement as any).clientWidth = 1000;
    (this.documentElement as any).clientHeight = 800;
  }

  createElement(tag: string): MockEl {
    const el = new MockEl(tag);
    el.ownerDocument = this;
    return el;
  }

  createElementNS(_ns: string, tag: string): MockEl {
    return this.createElement(tag);
  }

  addEventListener(n: string, f: (...args: any[]) => void): void {
    const arr = this.handlers.get(n) ?? [];
    arr.push(f);
    this.handlers.set(n, arr);
  }

  removeEventListener(n: string, f: (...args: any[]) => void): void {
    const arr = this.handlers.get(n);
    if (!arr) return;
    const idx = arr.indexOf(f);
    if (idx !== -1) arr.splice(idx, 1);
  }

  dispatchEvent(n: string, eventData: any = {}): void {
    const arr = this.handlers.get(n);
    if (arr) {
      for (const fn of [...arr]) fn(eventData);
    }
  }
}

const { Toolbar, DEFAULT_TOOL_ORDER } = await import(
  "../../src/view/toolbar"
);
const { MorePanel } = await import("../../src/view/more-panel");

describe("Modular toolbar: reordering, hiding, and three-dots integration", () => {
  let doc: MockDoc;
  let host: MockEl;

  beforeEach(() => {
    doc = new MockDoc();
    host = doc.createElement("div");
    doc.body.appendChild(host);
    (globalThis as any).activeDocument = doc as any;
    (globalThis as any).document = doc as any;
    globalThis.window = {
      ...doc.defaultView,
      clearInterval: (id: any) => globalThis.clearInterval(id),
      clearTimeout: (id: any) => globalThis.clearTimeout(id),
      setTimeout: (fn: any, ms: any) => globalThis.setTimeout(fn, ms),
    } as any;
  });

  function createTestToolbar(options: any = {}, callbacks: any = {}) {
    const layoutChangeSpy = vi.fn();
    const toolChangeSpy = vi.fn();
    const defaultCb = {
      onToolChange: toolChangeSpy,
      onColorChange: vi.fn(),
      onSizeChange: vi.fn(),
      onPressureToggle: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onAddPage: vi.fn(),
      onShare: vi.fn(),
      onSettings: vi.fn(),
      onMore: vi.fn(),
      onToolbarLayoutChange: layoutChangeSpy,
      ...callbacks,
    };
    const state = { tool: "pen", color: "#000000", size: 3 } as any;
    const toolbar = new Toolbar(
      host as unknown as HTMLElement,
      ["#000000", "#ff0000"],
      [1, 3, 5],
      state,
      defaultCb,
      options,
    );
    return { toolbar, layoutChangeSpy, toolChangeSpy, state };
  }

  it("renders all default tools in default order by default", () => {
    const { toolbar } = createTestToolbar();
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    expect(toolsGroup).not.toBeNull();
    const buttons = toolsGroup!.querySelectorAll("button");
    const toolIds = buttons.map((b) => b.dataset.toolId);
    expect(toolIds).toEqual(DEFAULT_TOOL_ORDER);
    expect(toolbar.getHiddenTools()).toEqual([]);
  });

  it("respects customized toolbarToolOrder and hiddenToolbarTools options", () => {
    const customOrder = ["pen", "eraser", "select", "text", "shape", "image", "record"];
    const customHidden = ["select", "record"];
    const { toolbar } = createTestToolbar({
      toolbarToolOrder: customOrder,
      hiddenToolbarTools: customHidden,
    });
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    const buttons = toolsGroup!.querySelectorAll("button");
    const visibleIds = buttons.map((b) => b.dataset.toolId);
    expect(visibleIds).toEqual(["pen", "eraser", "text", "shape", "image"]);
    const hidden = toolbar.getHiddenTools();
    expect(hidden.map((h) => h.id)).toEqual(["select", "record"]);
  });

  it("hides a tool and reports layout change", () => {
    const { toolbar, layoutChangeSpy } = createTestToolbar();
    toolbar.hideTool("shape");
    expect(layoutChangeSpy).toHaveBeenCalledWith(
      expect.arrayContaining(["shape"]),
      ["shape"],
    );
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    const buttons = toolsGroup!.querySelectorAll("button");
    expect(buttons.map((b) => b.dataset.toolId)).not.toContain("shape");
    expect(toolbar.getHiddenTools().map((h) => h.id)).toEqual(["shape"]);
  });

  it("switches active tool to fallback if the active tool is hidden", () => {
    const { toolbar, toolChangeSpy } = createTestToolbar();
    toolbar.hideTool("pen");
    expect(toolChangeSpy).toHaveBeenCalled();
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    const buttons = toolsGroup!.querySelectorAll("button");
    expect(buttons.map((b) => b.dataset.toolId)).not.toContain("pen");
  });

  it("does not allow hiding the last remaining tool", () => {
    const customHidden = ["select", "pen", "eraser", "text", "shape", "image"];
    const { toolbar, layoutChangeSpy } = createTestToolbar({
      hiddenToolbarTools: customHidden,
    });
    layoutChangeSpy.mockClear();
    toolbar.hideTool("record");
    expect(layoutChangeSpy).not.toHaveBeenCalled();
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    const buttons = toolsGroup!.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].dataset.toolId).toBe("record");
  });

  it("unhides a tool and can activate it", () => {
    const { toolbar, layoutChangeSpy, toolChangeSpy } = createTestToolbar({
      hiddenToolbarTools: ["eraser"],
    });
    layoutChangeSpy.mockClear();
    toolbar.unhideTool("eraser", true);
    expect(layoutChangeSpy).toHaveBeenCalledWith(
      expect.any(Array),
      [],
    );
    expect(toolChangeSpy).toHaveBeenCalledWith("eraser");
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    const buttons = toolsGroup!.querySelectorAll("button");
    expect(buttons.map((b) => b.dataset.toolId)).toContain("eraser");
    expect(toolbar.getHiddenTools()).toEqual([]);
  });

  it("resets toolbar layout to defaults", () => {
    const { toolbar, layoutChangeSpy } = createTestToolbar({
      toolbarToolOrder: ["eraser", "pen"],
      hiddenToolbarTools: ["select", "text"],
    });
    layoutChangeSpy.mockClear();
    toolbar.resetToolbarLayout();
    expect(layoutChangeSpy).toHaveBeenCalledWith(
      [...DEFAULT_TOOL_ORDER],
      [],
    );
    const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools");
    const buttons = toolsGroup!.querySelectorAll("button");
    expect(buttons.map((b) => b.dataset.toolId)).toEqual(DEFAULT_TOOL_ORDER);
    expect(toolbar.getHiddenTools()).toEqual([]);
  });

  it("displays hidden tools in MorePanel and allows unhiding", () => {
    const unhideSpy = vi.fn();
    const resetSpy = vi.fn();
    const anchor = doc.createElement("button");
    doc.body.appendChild(anchor);

    const hiddenTools = [
      { id: "eraser", icon: "eraser", name: "Eraser" },
      { id: "shape", icon: "shapes", name: "Shapes" },
    ];

    const morePanel = new MorePanel(
      anchor as unknown as HTMLElement,
      {
        index: 0,
        total: 1,
        bookmarked: false,
        titled: false,
        cover: false,
        single: true,
        clearable: false,
      },
      {
        paintThumbnail: vi.fn(),
        toggleBookmark: vi.fn(),
        editTitle: vi.fn(),
        copyLink: vi.fn(),
        duplicate: vi.fn(),
        changeTemplate: vi.fn(),
        goToPage: vi.fn(),
        clear: vi.fn(),
        remove: vi.fn(),
        hiddenTools,
        unhideTool: unhideSpy,
        resetToolbarLayout: resetSpy,
      },
    );

    const moreEl = doc.body.querySelector(".goodobsidian-more");
    expect(moreEl).not.toBeNull();

    // Check heading
    const headings = moreEl!.querySelectorAll(".goodobsidian-more-heading");
    const hiddenHeading = headings.find((h) => h.textContent === "Hidden tools");
    expect(hiddenHeading).toBeDefined();

    // Check hidden tool rows
    const hiddenRows = moreEl!.querySelectorAll(".goodobsidian-more-hidden-tool");
    expect(hiddenRows.length).toBe(2);
    expect(hiddenRows[0].textContent).toContain("Eraser");
    expect(hiddenRows[0].textContent).toContain("Unhide");
    expect(hiddenRows[1].textContent).toContain("Shapes");

    // Click on unhide row
    hiddenRows[0].click();
    expect(unhideSpy).toHaveBeenCalledWith("eraser");
    expect(morePanel.isOpen).toBe(false);
  });

  it("MorePanel keyboard accessibility: Enter key activates unhide", () => {
    const unhideSpy = vi.fn();
    const anchor = doc.createElement("div");
    doc.body.appendChild(anchor);

    const hiddenTools = [{ id: "eraser", icon: "eraser", name: "Eraser" }];

    const morePanel = new MorePanel(
      anchor as unknown as HTMLElement,
      {
        index: 0,
        total: 1,
        bookmarked: false,
        titled: false,
        cover: false,
        single: true,
        clearable: false,
      },
      {
        paintThumbnail: vi.fn(),
        toggleBookmark: vi.fn(),
        editTitle: vi.fn(),
        copyLink: vi.fn(),
        duplicate: vi.fn(),
        changeTemplate: vi.fn(),
        goToPage: vi.fn(),
        clear: vi.fn(),
        remove: vi.fn(),
        hiddenTools,
        unhideTool: unhideSpy,
      },
    );

    const moreEl = doc.body.querySelector(".goodobsidian-more");
    const hiddenRow = moreEl!.querySelector(".goodobsidian-more-hidden-tool");
    expect(hiddenRow).not.toBeNull();

    hiddenRow!.dispatchEvent("keydown", { key: "Enter", preventDefault: vi.fn() });
    expect(unhideSpy).toHaveBeenCalledWith("eraser");
    expect(morePanel.isOpen).toBe(false);
  });

  it("retains recording state across toolbar rebuild / tool toggling", () => {
    const { toolbar } = createTestToolbar({}, {
      onRecord: vi.fn(),
    });

    const recordBtn = doc.body.querySelector('[data-tool-id="record"]');
    expect(recordBtn).not.toBeNull();
    expect(recordBtn!.hasClass("is-recording")).toBe(false);

    toolbar.setRecording(true);
    expect(recordBtn!.hasClass("is-recording")).toBe(true);
    expect(recordBtn!.attrs["aria-pressed"]).toBe("true");
    expect(recordBtn!.attrs["aria-label"]).toBe("Stop recording");

    // Hide another tool, triggering renderToolsGroup() rebuild
    toolbar.hideTool("shape");
    const newRecordBtn = doc.body.querySelector('[data-tool-id="record"]');
    expect(newRecordBtn).not.toBeNull();
    expect(newRecordBtn!.hasClass("is-recording")).toBe(true);
    expect(newRecordBtn!.attrs["aria-pressed"]).toBe("true");
    expect(newRecordBtn!.attrs["aria-label"]).toBe("Stop recording");

    toolbar.setRecording(false);
    expect(newRecordBtn!.hasClass("is-recording")).toBe(false);
    expect(newRecordBtn!.attrs["aria-pressed"]).toBe("false");
    expect(newRecordBtn!.attrs["aria-label"]).toBe("Record audio");
  });

  it("pointer hold and drag reorders tools dynamically and commits new order", () => {
    vi.useFakeTimers();
    try {
      const layoutSpy = vi.fn();
      createTestToolbar({}, {
        onToolbarLayoutChange: layoutSpy,
      });

      const toolsGroup = doc.body.querySelector(".goodobsidian-bar-group.is-tools")!;
      const buttons = toolsGroup.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThan(2);

      const firstBtn = buttons[0];
      const initialFirstId = firstBtn.dataset.toolId;

      // Pointer down on first tool
      firstBtn.dispatchEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 20,
        clientY: 20,
      });

      // Advance timer by 400ms to trigger hold
      vi.advanceTimersByTime(400);
      expect(toolsGroup.hasClass("is-reordering")).toBe(true);
      expect(firstBtn.hasClass("is-drag-held")).toBe(true);

      // Drag rightward past third tool
      doc.dispatchEvent("pointermove", {
        pointerId: 1,
        clientX: 180,
        clientY: 20,
        preventDefault: vi.fn(),
      });

      expect(firstBtn.hasClass("is-dragging")).toBe(true);

      // Pointer up commits new order
      doc.dispatchEvent("pointerup", {
        pointerId: 1,
      });

      expect(toolsGroup.hasClass("is-reordering")).toBe(false);
      expect(firstBtn.hasClass("is-dragging")).toBe(false);
      expect(firstBtn.hasClass("is-drag-held")).toBe(false);

      expect(layoutSpy).toHaveBeenCalled();
      const newOrder = layoutSpy.mock.calls[0][0];
      expect(newOrder[0]).not.toBe(initialFirstId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("early pointer release before 400ms cancels hold without reordering", () => {
    vi.useFakeTimers();
    try {
      const layoutSpy = vi.fn();
      createTestToolbar({}, {
        onToolbarLayoutChange: layoutSpy,
      });

      const toolsGroup = doc.body.querySelector(".goodobsidian-bar-group.is-tools")!;
      const buttons = toolsGroup.querySelectorAll("button");
      const firstBtn = buttons[0];

      firstBtn.dispatchEvent("pointerdown", {
        button: 0,
        pointerId: 2,
        clientX: 20,
        clientY: 20,
      });

      // Only advance 150ms then release
      vi.advanceTimersByTime(150);
      doc.dispatchEvent("pointerup", { pointerId: 2 });

      // Advance past 400ms
      vi.advanceTimersByTime(300);

      expect(toolsGroup.hasClass("is-reordering")).toBe(false);
      expect(firstBtn.hasClass("is-drag-held")).toBe(false);
      expect(layoutSpy).not.toHaveBeenCalled();
      expect(doc.body.querySelector(".goodobsidian-tool-popover")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("popover dismissal cleanly unbinds document listeners on Escape", () => {
    vi.useFakeTimers();
    try {
      createTestToolbar();
      const penBtn = doc.body.querySelector('[data-tool-id="pen"]')!;

      // Right-click opens popover immediately
      penBtn.dispatchEvent("contextmenu", { preventDefault: vi.fn() });

      const popover = doc.body.querySelector(".goodobsidian-tool-popover");
      expect(popover).not.toBeNull();

      vi.advanceTimersByTime(20);

      // Press Escape
      doc.dispatchEvent("keydown", { key: "Escape" });
      expect(doc.body.querySelector(".goodobsidian-tool-popover")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Toolbar.destroy while gesture is in flight cleans up document listeners without leaks", () => {
    const { toolbar } = createTestToolbar();
    const penBtn = doc.body.querySelector('[data-tool-id="pen"]')!;

    // Start a pointer press
    penBtn.dispatchEvent("pointerdown", {
      button: 0,
      pointerId: 4,
      clientX: 50,
      clientY: 20,
    });

    const moveHandlers = doc.handlers.get("pointermove") ?? [];
    expect(moveHandlers.length).toBeGreaterThan(0);

    // Destroy toolbar during press
    toolbar.destroy();

    const moveHandlersAfter = doc.handlers.get("pointermove") ?? [];
    expect(moveHandlersAfter.length).toBe(0);
  });

  it("keyboard focus is preserved on surviving tool when hiding, and on restored tool when unhiding", () => {
    const { toolbar } = createTestToolbar();
    toolbar.hideTool("shape");

    const activePen = doc.body.querySelector('[data-tool-id="pen"]')!;
    expect(activePen.isFocused).toBe(true);

    toolbar.unhideTool("shape");
    const restoredShape = doc.body.querySelector('[data-tool-id="shape"]')!;
    expect(restoredShape.isFocused).toBe(true);
  });

  it("moves a tool all the way across the toolbar past the last tool in one continuous swoop", () => {
    vi.useFakeTimers();
    try {
      const layoutSpy = vi.fn();
      createTestToolbar({}, {
        onToolbarLayoutChange: layoutSpy,
      });

      const toolsGroup = host.querySelector(".goodobsidian-bar-group.is-tools")!;
      const buttons = toolsGroup.querySelectorAll("button");
      const firstBtn = buttons[0];
      expect(firstBtn.dataset.toolId).toBe("select");

      // Pointer down on lasso tool
      firstBtn.dispatchEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 20,
        clientY: 20,
      });

      vi.advanceTimersByTime(400);
      expect(toolsGroup.hasClass("is-reordering")).toBe(true);
      expect(firstBtn.hasClass("is-drag-held")).toBe(true);

      // Drag all the way to clientX 450 (well past the last tool at index 6, which is record at x~310..350)
      doc.dispatchEvent("pointermove", {
        pointerId: 1,
        clientX: 450,
        clientY: 20,
        preventDefault: vi.fn(),
      });

      expect(firstBtn.hasClass("is-dragging")).toBe(true);

      // Pointer up commits new order
      doc.dispatchEvent("pointerup", {
        pointerId: 1,
      });

      expect(toolsGroup.hasClass("is-reordering")).toBe(false);
      expect(firstBtn.hasClass("is-dragging")).toBe(false);
      expect(firstBtn.hasClass("is-drag-held")).toBe(false);

      expect(layoutSpy).toHaveBeenCalled();
      const newOrder = layoutSpy.mock.calls[0][0];
      // "select" should now be at the very end (index 6, right after "record")
      expect(newOrder[newOrder.length - 1]).toBe("select");
      expect(newOrder[0]).not.toBe("select");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dynamically toggles lasso icon between freehand and rectangular lasso when mode changes", () => {
    const { toolbar, state } = createTestToolbar();
    const selectBtn = host.querySelector('[data-tool-id="select"]')!;
    expect(selectBtn.getAttribute("aria-label")).toBe("Lasso select (V)");

    // Switch state to rect mode
    state.lassoMode = "rect";
    toolbar.syncActive();
    expect(selectBtn.getAttribute("aria-label")).toBe("Rectangular select (V)");

    // Switch back to freehand mode
    state.lassoMode = "freehand";
    toolbar.syncActive();
    expect(selectBtn.getAttribute("aria-label")).toBe("Lasso select (V)");
  });

  it("supports toolbar docking positions (top, bottom, left, right) and position changes", () => {
    const posSpy = vi.fn();
    const { toolbar } = createTestToolbar(
      { toolbarPosition: "top" },
      { onToolbarPositionChange: posSpy },
    );

    expect(toolbar.getToolbarPosition()).toBe("top");
    expect(host.hasClass("is-pos-top")).toBe(true);

    toolbar.setToolbarPosition("left");
    expect(toolbar.getToolbarPosition()).toBe("left");
    expect(host.hasClass("is-pos-left")).toBe(true);
    expect(host.hasClass("is-pos-top")).toBe(false);

    toolbar.setToolbarPosition("bottom");
    expect(toolbar.getToolbarPosition()).toBe("bottom");
    expect(host.hasClass("is-pos-bottom")).toBe(true);

    toolbar.setToolbarPosition("right");
    expect(toolbar.getToolbarPosition()).toBe("right");
    expect(host.hasClass("is-pos-right")).toBe(true);
  });

  it("moves options pill up with buffer when toolbar moves to the side while keeping options pill horizontal by default", () => {
    const { toolbar } = createTestToolbar({ toolbarPosition: "top" });
    const optionsEl = host.querySelector(".goodobsidian-options")!;

    expect(toolbar.getOptionsPosition()).toBe("top");
    expect(optionsEl.hasClass("is-pos-top")).toBe(true);
    // When toolbar is at top, options sits below the bar
    expect(parseInt(optionsEl.style.top ?? "0", 10)).toBeGreaterThan(8);

    // Move toolbar to the left
    toolbar.setToolbarPosition("left");
    // Options pill stays at top by default, but moves up to EDGE_INSET (8px) buffer
    expect(toolbar.getOptionsPosition()).toBe("top");
    expect(optionsEl.hasClass("is-pos-top")).toBe(true);
    expect(optionsEl.style.top).toBe("8px");

    // Move toolbar to the right
    toolbar.setToolbarPosition("right");
    expect(optionsEl.style.top).toBe("8px");

    // Move toolbar to the bottom
    toolbar.setToolbarPosition("bottom");
    expect(optionsEl.style.top).toBe("8px");
  });

  it("supports options pill docking to bottom, left, and right", () => {
    const optSpy = vi.fn();
    const { toolbar } = createTestToolbar(
      { toolbarPosition: "top" },
      { onOptionsPositionChange: optSpy },
    );
    const optionsEl = host.querySelector(".goodobsidian-options")!;

    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 } as DOMRect);
    toolbar.setOptionsPosition("bottom");
    expect(toolbar.getOptionsPosition()).toBe("bottom");
    expect(optionsEl.hasClass("is-pos-bottom")).toBe(true);

    toolbar.setOptionsPosition("left");
    expect(toolbar.getOptionsPosition()).toBe("left");
    expect(optionsEl.hasClass("is-pos-left")).toBe(true);
    expect(optionsEl.style.maxWidth).toBe("60px");

    toolbar.setOptionsPosition("right");
    expect(toolbar.getOptionsPosition()).toBe("right");
    expect(optionsEl.hasClass("is-pos-right")).toBe(true);
    expect(optionsEl.style.maxWidth).toBe("60px");
  });

  it("suppresses touch scrolling when dock hold gesture is triggered", () => {
    vi.useFakeTimers();
    try {
      createTestToolbar({ toolbarPosition: "left" });
      const barEl = host.querySelector(".goodobsidian-toolbar")!;

      // Pointer down on blank space
      barEl.dispatchEvent("pointerdown", { button: 0, pointerId: 10, clientX: 25, clientY: 100, target: barEl });
      expect(barEl.hasClass("is-bar-held")).toBe(false);

      // Fast forward past 400ms hold
      vi.advanceTimersByTime(400);
      expect(barEl.hasClass("is-bar-held")).toBe(true);
      expect(barEl.style.overflow).toBe("hidden");
      expect(barEl.style.touchAction).toBe("none");

      doc.dispatchEvent("touchstart", {
        changedTouches: [{ identifier: 42, clientX: 25, clientY: 100 }],
      });
      // Verify only the active touch is prevented
      let prevented = false;
      const touchMoveEvent = {
        changedTouches: [{ identifier: 42 }],
        cancelable: true,
        preventDefault: () => { prevented = true; },
      };
      doc.dispatchEvent("touchmove", touchMoveEvent);
      expect(prevented).toBe(true);
      prevented = false;
      doc.dispatchEvent("touchmove", { ...touchMoveEvent, changedTouches: [{ identifier: 99 }] });
      expect(prevented).toBe(false);
      barEl.dispatchEvent("pointerdown", { button: 0, pointerId: 11, isPrimary: false, target: barEl });
      doc.dispatchEvent("pointerup", { pointerId: 11 });
      expect(barEl.hasClass("is-bar-held")).toBe(true);

      // Pointer up releases held state and restores overflow
      doc.dispatchEvent("pointerup", { pointerId: 10, clientX: 25, clientY: 100 });
      expect(barEl.hasClass("is-bar-held")).toBe(false);
      expect(barEl.style.overflow).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fits all dock combinations and measures after clearing the old orientation", () => {
    const { toolbar } = createTestToolbar();
    const options = host.querySelector(".goodobsidian-options")!;
    const bar = host.querySelector(".goodobsidian-toolbar")!;
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 } as DOMRect);
    const positions = ["top", "bottom", "left", "right"] as const;
    for (const barPos of positions) {
      bar.getBoundingClientRect = () => ({
        left: barPos === "right" ? 340 : 0, right: barPos === "left" ? 60 : 400,
        top: barPos === "bottom" ? 240 : 0, bottom: barPos === "top" ? 60 : 300,
        width: 60, height: 60,
      } as DOMRect);
      toolbar.setToolbarPosition(barPos);
      for (const optPos of positions) {
        options.getBoundingClientRect = () => ({
          width: Math.min(optPos === "left" || optPos === "right" ? 60 : 600, parseFloat(options.style.maxWidth)),
          height: Math.min(optPos === "left" || optPos === "right" ? 600 : 60, parseFloat(options.style.maxHeight)),
        } as DOMRect);
        toolbar.setOptionsPosition(optPos);
        toolbar.applyPosition();
        expect(options.hasClass(`is-pos-${optPos}`)).toBe(true);
        const x = parseFloat(options.style.left);
        const y = parseFloat(options.style.top);
        const box = options.getBoundingClientRect();
        expect(x).toBeGreaterThanOrEqual(barPos === "left" ? 68 : 8);
        expect(y).toBeGreaterThanOrEqual(barPos === "top" ? 68 : 8);
        expect(x + box.width).toBeLessThanOrEqual(barPos === "right" ? 332 : 392);
        expect(y + box.height).toBeLessThanOrEqual(barPos === "bottom" ? 232 : 292);
      }
    }
  });

  it("respects opposing movement near an edge threshold", () => {
    const { toolbar } = createTestToolbar();
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 } as DOMRect);
    expect((toolbar as any).computeDockCandidate({ clientX: 20, clientY: 80 }, "left", 20, 30)).toBe("bottom");
    expect((toolbar as any).computeDockCandidate({ clientX: 80, clientY: 20 }, "top", 30, 20)).toBe("right");
  });

  it("places options popovers using their own dock and visible viewport", () => {
    const { toolbar } = createTestToolbar();
    const options = host.querySelector(".goodobsidian-options")!;
    const anchor = options.createEl("button");
    const popover = host.createDiv();
    (toolbar as any).popover = popover;
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 } as DOMRect);
    anchor.getBoundingClientRect = () => ({ left: 840, right: 880, top: 100, bottom: 140, width: 40, height: 40 } as DOMRect);
    popover.getBoundingClientRect = () => ({ width: 280, height: 200 } as DOMRect);
    (toolbar as any).optionsPosition = "right";
    doc.defaultView.visualViewport.width = 900;
    (toolbar as any).keepPopoverInside(anchor);
    expect(parseFloat(popover.style.left)).toBe(552);
    expect(popover.style.transform).toBe("none");
    expect(parseFloat(popover.style.left) + 280).toBeLessThan(840);
  });

  it("keeps the options docking hold owned by the first pointer", () => {
    vi.useFakeTimers();
    try {
      createTestToolbar();
      const options = host.querySelector(".goodobsidian-options")!;
      options.dispatchEvent("pointerdown", { button: 0, pointerId: 20, clientX: 25, clientY: 100, target: options });
      options.dispatchEvent("pointerdown", { button: 0, pointerId: 21, clientX: 30, clientY: 100, target: options });
      vi.advanceTimersByTime(400);
      expect(options.hasClass("is-pill-held")).toBe(true);
      doc.dispatchEvent("pointercancel", { pointerId: 21 });
      expect(options.hasClass("is-pill-held")).toBe(true);
      doc.dispatchEvent("pointercancel", { pointerId: 20 });
      expect(options.hasClass("is-pill-held")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows four noninteractive dock silhouettes and removes them on cancellation", () => {
    vi.useFakeTimers();
    try {
      createTestToolbar();
      const bar = host.querySelector(".goodobsidian-toolbar")!;
      bar.dispatchEvent("pointerdown", { button: 0, pointerId: 20, clientX: 10, clientY: 10, target: bar });
      vi.advanceTimersByTime(400);
      const layer = host.querySelector(".goodobsidian-dock-previews")!;
      expect(layer.getAttribute("aria-hidden")).toBe("true");
      const previews = layer.querySelectorAll(".goodobsidian-dock-preview");
      expect(previews).toHaveLength(4);
      for (const frame of previews) {
        const ghost = frame.querySelector(".goodobsidian-dock-silhouette")!;
        expect(ghost.hasClass(`is-pos-${frame.getAttribute("data-dock")}`)).toBe(true);
        expect(ghost.querySelectorAll("button").length).toBe(bar.querySelectorAll("button").length);
        expect(ghost.handlers.size).toBe(0);
      }
      doc.dispatchEvent("pointercancel", { pointerId: 20 });
      expect(host.querySelector(".goodobsidian-dock-previews")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("verifies sidebar z-index hierarchy and rectangular lasso icon registration", () => {
    const fs = require("fs");
    const stylesCss = fs.readFileSync(path.resolve(__dirname, "../../styles.css"), "utf8");
    const toolbarTs = fs.readFileSync(path.resolve(__dirname, "../../src/view/toolbar.ts"), "utf8");

    // Obsidian supplies the icon viewport; nesting a 24px svg made the icon tiny.
    const icon = toolbarTs.match(/const RECTANGULAR_LASSO_SVG = `([^`]+)`/)?.[1];
    expect(icon?.startsWith("<g")).toBe(true);
    expect(icon?.includes("stroke-width=")).toBe(false);
    expect(toolbarTs.includes('setAttribute("viewBox", "0 0 24 24")')).toBe(true);
    expect(icon?.includes('<circle cx="5" cy="16" r="2"')).toBe(true);
    expect(icon?.includes("<svg")).toBe(false);
    expect(toolbarTs.includes('isRect ? "finenotes-rectangular-lasso" : "lasso"')).toBe(true);

    // Verify .goodobsidian-pagesidebar-top has z-index: 10
    expect(stylesCss).toMatch(/\.goodobsidian-pagesidebar-top\s*\{[^}]*z-index:\s*10;/);

    // Verify .goodobsidian-page-check has z-index: 1 (so it never scrolls over top header)
    expect(stylesCss).toMatch(/\.goodobsidian-page-check\s*\{[^}]*z-index:\s*1;/);

    // Verify .goodobsidian-pages-header is NOT made transparent
    expect(stylesCss).not.toContain(".goodobsidian-pages-header { background: transparent; }");
  });
});

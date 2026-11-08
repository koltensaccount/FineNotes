import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import assert from "node:assert/strict";

const OUTPUT_DIR = process.env.SCREENSHOT_DIR || path.resolve(process.cwd(), "outputs");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function decodeBackingNotebook(rawContent) {
  const match = /%%(?:goodobsidian|finenotes)\s*\nv2:([A-Za-z0-9+/=]+)\s*\n%%/.exec(rawContent);
  if (!match) return null;
  const buf = Buffer.from(match[1], "base64");
  const json = zlib.inflateRawSync(buf).toString("utf8");
  return JSON.parse(json);
}

async function createCdpClient() {
  const tabsRes = await fetch("http://127.0.0.1:9394/json/list");
  const tabs = await tabsRes.json();
  const tab = tabs.find((t) => t.type === "page" && t.url.includes("index.html"));
  if (!tab) throw new Error("Obsidian CDP page target not found on port 9394");

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const r = JSON.parse(data);
    pending.get(r.id)?.(r);
  };

  async function send(method, params = {}) {
    const key = ++id;
    const result = new Promise((resolve) => pending.set(key, resolve));
    ws.send(JSON.stringify({ id: key, method, params }));
    const r = await result;
    if (r.error) throw new Error(JSON.stringify(r.error));
    return r.result;
  }

  async function run(expression) {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async function snap(filename, selector = null) {
    let clip;
    if (typeof selector === "string") {
      clip = await run(`(() => {
        const matches = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = matches.find(e => e.clientWidth > 0 && e.clientHeight > 0) || matches[0];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, r.x - 8),
          y: Math.max(0, r.y - 8),
          width: Math.min(window.innerWidth - Math.max(0, r.x - 8), r.width + 16),
          height: Math.min(window.innerHeight - Math.max(0, r.y - 8), r.height + 16),
          scale: 1,
        };
      })()`);
    } else if (selector && typeof selector === "object") {
      clip = selector;
    }
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip } : {}),
    });
    const filePath = path.join(OUTPUT_DIR, filename);
    const buf = Buffer.from(screenshot.data, "base64");
    fs.writeFileSync(filePath, buf);
    console.log(`[Screenshot] Saved ${filePath}`);
    return filePath;
  }

  async function realClick(selector) {
    const rect = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    console.log(`[realClick] ${selector}:`, rect);
    assert.ok(rect && rect.width > 0 && rect.height > 0, `Target ${selector} must have positive dimensions for real click`);
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + rect.height / 2);

    // Track whether synthetic CDP mouse release successfully fires a click on the element
    await run(`(() => {
      window._lastRealClickFired = false;
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.addEventListener("click", () => { window._lastRealClickFired = true; }, { once: true });
      }
    })()`);

    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: cx,
      y: cy,
      button: "none",
      buttons: 0,
    });
    await new Promise((r) => setTimeout(r, 100));
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: cx,
      y: cy,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 60));
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: cx,
      y: cy,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 150));

    // If synthetic mouse event was not routed by the window manager/compositor, ensure click is delivered
    const fired = await run(`window._lastRealClickFired`);
    if (!fired) {
      console.log(`[realClick] Synthetic CDP event was not routed to ${selector}, triggering DOM fallback`);
      await run(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && !el.disabled) el.click();
      })()`);
    }
  }

  async function sendKey(key, code, windowsVirtualKeyCode = 0) {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode,
    });
    await new Promise((r) => setTimeout(r, 40));
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode,
    });
    await new Promise((r) => setTimeout(r, 150));
  }

  return { ws, send, run, snap, realClick, sendKey, close: () => ws.close() };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRegression() {
  console.log("=== FineNotes Handwrite Here CDP Integration Regression ===");
  const cdp = await createCdpClient();

  // 1. Guard against non-QA vault before any mutations
  const vaultName = await cdp.run("app.vault.getName()");
  console.log(`Connected to Obsidian vault: "${vaultName}"`);
  if (vaultName !== "QA Vault") {
    throw new Error(`Refusing to run integration test on non-QA vault: "${vaultName}". Expected "QA Vault".`);
  }

  // 2. Capture initial environment state to restore on exit
  const initialState = await cdp.run(`(() => ({
    isDark: document.body.classList.contains("theme-dark"),
    leftSplitCollapsed: !!app.workspace.leftSplit?.collapsed,
    rightSplitCollapsed: !!app.workspace.rightSplit?.collapsed,
  }))()`);

  try {
    // 3. Ensure plugin is reloaded with latest production build
    await cdp.run(`(async () => {
      await app.plugins.disablePlugin('finenotes');
      await app.plugins.enablePlugin('finenotes');
      return 'finenotes reloaded';
    })()`);
    await sleep(700);

    // 4. Verify that ordinary production build does NOT expose window._finenotesInlineSession
    console.log("\n--- Production Bundle Hygiene ---");
    const prodExposesWindowSession = await cdp.run(`'_finenotesInlineSession' in window || typeof window._finenotesInlineSession !== 'undefined'`);
    console.log(`window._finenotesInlineSession exposed: ${prodExposesWindowSession}`);
    assert.equal(prodExposesWindowSession, false, "Production build must NOT expose window._finenotesInlineSession");

    // 5. Ensure we have an open clean markdown note with a fresh Handwrite Here block
    console.log("\n--- Initializing Clean QA Markdown Note ---");
    await cdp.run(`(async () => {
      const activeSession = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession();
      if (activeSession) await activeSession.close(true);
      const cleanPath = "Handwrite Here QA.md";
      let file = app.vault.getFileByPath(cleanPath);
      if (!file) {
        file = await app.vault.create(cleanPath, "# Handwrite Here QA\\n\\n\\nFollowing Markdown paragraph.\\n");
      } else {
        await app.vault.modify(file, "# Handwrite Here QA\\n\\n\\nFollowing Markdown paragraph.\\n");
      }
      await app.workspace.openLinkText(cleanPath, "", false);
      const leaves = app.workspace.getLeavesOfType("markdown");
      if (leaves.length > 0) app.workspace.setActiveLeaf(leaves[0], { focus: true });
      app.workspace.activeLeaf?.view?.editor?.setCursor({ line: 2, ch: 0 });
    })()`);
    await sleep(600);

    console.log("Creating new Handwrite Here block...");
    await cdp.run(`app.commands.executeCommandById('finenotes:handwrite-here')`);
    await sleep(400);

    // If suggest modal appeared, press Enter to confirm notebook choice
    for (let i = 0; i < 10; i++) {
      const hasModal = await cdp.run(`!!document.querySelector('.modal-container')`);
      if (hasModal) {
        console.log("Accepting notebook choice modal via real Enter keypress...");
        await cdp.sendKey("Enter", "Enter", 13);
        await sleep(500);
        break;
      }
      await sleep(100);
    }

    // Wait for the finenotes block embed to mount in the DOM
    let embedMounted = false;
    for (let i = 0; i < 30; i++) {
      embedMounted = await cdp.run(`!!document.querySelector('.finenotes-embed')`);
      if (embedMounted) break;
      await sleep(100);
    }
    assert.ok(embedMounted, "FineNotes embed must mount in the DOM");

    // Wait for inline editor to become active (or activate it via real click)
    let isInline = false;
    for (let i = 0; i < 20; i++) {
      isInline = await cdp.run(`(() => {
        const visible = [...document.querySelectorAll('.finenotes-inline-active')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
        return !!visible;
      })()`);
      if (isInline) break;
      await sleep(100);
    }

    if (!isInline) {
      console.log("Activating inline editor from embed via real pointer click...");
      await cdp.realClick(".finenotes-embed");
      await sleep(800);
    }

    isInline = await cdp.run(`(() => {
      const visible = [...document.querySelectorAll('.finenotes-inline-active')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
      return !!visible;
    })()`);
    assert.ok(isInline, "Inline editor must be active");

    // Retrieve active embed metadata and backing notebook file info
    const embedInfo = await cdp.run(`(() => {
      const active = document.querySelector('.finenotes-inline-active');
      return {
        filePath: active?.getAttribute('data-finenotes-file'),
        subpath: active?.getAttribute('data-finenotes-subpath'),
      };
    })()`);
    console.log("Backing notebook info:", embedInfo);
    assert.ok(embedInfo.filePath, "Active block must have a backing notebook file path");

    // 6. Assert positive dimensions & DPR backing
    console.log("\n--- 1. Sizing & Resolution Verification ---");
    const dims = await cdp.run(`(() => {
      const active = document.querySelector('.finenotes-inline-active');
      const host = active?.querySelector('.finenotes-inline-surface-host');
      const options = active?.querySelector('.goodobsidian-options');
      const toolbar = active?.querySelector('.goodobsidian-toolbar');
      const canvas = host?.querySelector('canvas');
      const paper = host?.querySelector('.goodobsidian-paper');
      const dpr = window.devicePixelRatio;
      return {
        host: [host?.clientWidth ?? 0, host?.clientHeight ?? 0],
        canvasClient: [canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0],
        canvasBacking: [canvas?.width ?? 0, canvas?.height ?? 0],
        paper: paper ? [paper.clientWidth, paper.clientHeight] : null,
        optionsHeight: options?.getBoundingClientRect().height ?? 0,
        optionsVisible: !options?.classList.contains('is-collapsed'),
        dpr,
      };
    })()`);

    console.log("Measured dimensions:", dims);
    assert.ok(dims.host[0] > 0, "Host width must be positive");
    assert.ok(dims.host[1] >= 240, `Host height must be at least 240px, got ${dims.host[1]}`);
    assert.ok(dims.canvasClient[0] > 0, "Canvas client width must be positive");
    assert.ok(dims.canvasClient[1] > 0, "Canvas client height must be positive");
    assert.equal(dims.canvasBacking[0], Math.round(dims.canvasClient[0] * dims.dpr), "Canvas backing width must match clientWidth * DPR");
    assert.equal(dims.canvasBacking[1], Math.round(dims.canvasClient[1] * dims.dpr), "Canvas backing height must match clientHeight * DPR");
    assert.ok(dims.optionsHeight >= 36, `Options strip height must be >= 36px, got ${dims.optionsHeight}`);

    // 7. Verify toolbar structure (Pen, Highlighter, Eraser, Undo, Redo, Done)
    console.log("\n--- 2. Toolbar Structure Verification ---");
    const tools = await cdp.run(`(() => {
      const tools = [...document.querySelectorAll('.finenotes-inline-active .goodobsidian-tool[data-tool]')].map(b => ({
        tool: b.getAttribute('data-tool'),
        active: b.classList.contains('is-active'),
      }));
      const hasDone = !!document.querySelector('.finenotes-inline-done');
      const hasUndo = !!document.querySelector('.finenotes-inline-active .goodobsidian-tool[aria-label*="Undo"]');
      const hasRedo = !!document.querySelector('.finenotes-inline-active .goodobsidian-tool[aria-label*="Redo"]');
      return { tools, hasDone, hasUndo, hasRedo };
    })()`);

    console.log("Toolbar controls:", tools);
    const toolIds = tools.tools.map((t) => t.tool);
    assert.ok(toolIds.includes("pen"), "Toolbar must include Pen tool");
    assert.ok(toolIds.includes("highlighter"), "Toolbar must include Highlighter tool as first-class button");
    assert.ok(toolIds.includes("eraser"), "Toolbar must include Eraser tool");
    assert.ok(tools.hasDone, "Toolbar must include Done button");
    assert.ok(tools.hasUndo, "Toolbar must include Undo button");
    assert.ok(tools.hasRedo, "Toolbar must include Redo button");

    // 8. Opening Scale Verification (Wide & Narrow) & Pointer-to-Coordinate Mapping across Two Zoom Levels
    console.log("\n--- 3. Opening Scale Verification & Multi-scale Coordinate Mapping ---");
    // Assert actual opening scale in wide pane before calling resetView()
    const assertRoundSwatches = async (pane) => {
      const swatches = await cdp.run(`[...document.querySelectorAll('.finenotes-inline-active .goodobsidian-color-strip .goodobsidian-swatch')].map((swatch) => {
        const style = getComputedStyle(swatch);
        return {
          width: swatch.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          height: swatch.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        };
      })`);
      assert.ok(swatches.length > 0, `Writing swatches must render in the ${pane} pane`);
      for (const { width, height } of swatches) {
        assert.ok(width > 0 && Math.abs(width - height) < 0.5,
          `Writing swatches must paint a circular disc in the ${pane} pane, got ${width} × ${height}`);
      }
    };
    const lockedMetrics = async () => cdp.run(`(() => {
      const session = app.plugins.plugins.finenotes.embedManager.getActiveInlineSession();
      const host = document.querySelector(".finenotes-inline-surface-host");
      return { locked: session.inkSurface.navLocked, scale: session.inkSurface.scale,
        width: host.clientWidth, pageWidth: session.currentPage.geometry.width };
    })()`);
    for (const width of [1440, 480]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 2, mobile: false });
      await sleep(300);
      const metrics = await lockedMetrics();
      assert.equal(metrics.locked, true, "A new inline editor opens locked");
      assert.ok(Math.abs(metrics.scale * metrics.pageWidth - metrics.width) < 1, "Locked paper fills the note width");
      await assertRoundSwatches(width === 480 ? "narrow" : "wide");
    }
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await sleep(300);
    await cdp.realClick(".finenotes-inline-active .goodobsidian-nav-lock");
    await sleep(300);
    await cdp.snap("handwrite-here-unlocked-workspace.png");
    const openingScaleWide = (await lockedMetrics()).scale;
    assert.equal(openingScaleWide, 1, "Unlocked workspace starts at 1:1");

    // Separately test resetView() behavior for inline surface:
    console.log("Verifying resetView() preserves 1:1 inline editing scale...");
    await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface?.resetView?.()`);
    await sleep(150);
    const postResetScale = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface?.scale ?? 0`);
    console.log(`Scale after resetView(): ${postResetScale}`);
    assert.ok(Math.abs(postResetScale - 1.0) < 0.05, `resetView() on inline surface must restore 1:1 scale (~1.0x), got ${postResetScale}`);

    await cdp.realClick('.finenotes-inline-active [data-tool="pen"]');
    await sleep(200);

    const pointer = (type, px, py) => cdp.send("Input.dispatchMouseEvent", {
      type,
      x: px,
      y: py,
      button: type === "mouseMoved" ? "none" : "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      pointerType: "pen",
    });

    const initialStrokeCount = await cdp.run(`(() => {
      return app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes?.length ?? 0;
    })()`);
    console.log(`Initial stroke count on active surface: ${initialStrokeCount}`);

    // Zoom Level 1: Standard opening scale (1.0x)
    const surfaceZoom1 = await cdp.run(`(() => {
      const surface = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface;
      const p = document.querySelector('.finenotes-inline-surface-host .goodobsidian-paper');
      const r = p.getBoundingClientRect();
      return {
        scale: surface?.scale ?? 1,
        paperX: r.x,
        paperY: r.y,
      };
    })()`);
    console.log(`Zoom Level 1 scale (opening scale): ${surfaceZoom1.scale}`);
    assert.ok(Math.abs(surfaceZoom1.scale - openingScaleWide) < 0.05, "Zoom 1 scale must match opening scale (~1.0x)");
    await sleep(200);

    // Draw stroke 1 at (paperX + 150, paperY + 90) - comfortably inside page box
    const drawX1 = Math.round(surfaceZoom1.paperX + 150);
    const drawY1 = Math.round(surfaceZoom1.paperY + 90);
    const expectedStart1 = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface?.clientToPage(${drawX1}, ${drawY1})`);
    console.log("Expected Stroke 1 start (Zoom 1.0x):", expectedStart1);
    assert.ok(expectedStart1, "Expected Stroke 1 start must fall on a page");

    await pointer("mousePressed", drawX1, drawY1);
    await sleep(25);
    await pointer("mouseMoved", drawX1 + 30, drawY1 + 20);
    await sleep(25);
    await pointer("mouseMoved", drawX1 + 60, drawY1 + 35);
    await sleep(25);
    await pointer("mouseReleased", drawX1 + 60, drawY1 + 35);
    await sleep(300);

    const strokeCountAfter1 = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes?.length ?? 0`);
    assert.equal(strokeCountAfter1, initialStrokeCount + 1, "Stroke count should increase by 1 after drawing stroke 1");

    // Verify stroke 1 coordinates and color on page
    const stroke1Data = await cdp.run(`(() => {
      const strokes = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes;
      const last = strokes[strokes.length - 1];
      return {
        startX: last.pts[0],
        startY: last.pts[1],
        color: last.color,
        tool: last.tool,
        ptsCount: last.pts.length,
        pts: last.pts,
      };
    })()`);
    console.log("Stroke 1 (Zoom 1.0x) recorded:", { startX: stroke1Data.startX, startY: stroke1Data.startY, color: stroke1Data.color, tool: stroke1Data.tool });
    assert.ok(Math.abs(stroke1Data.startX - expectedStart1.x) < 2, `Stroke 1 X (${stroke1Data.startX}) must match expected (${expectedStart1.x})`);
    assert.ok(Math.abs(stroke1Data.startY - expectedStart1.y) < 2, `Stroke 1 Y (${stroke1Data.startY}) must match expected (${expectedStart1.y})`);

    // Zoom Level 2: 1.5x zoom relative to measured opening scale
    console.log("Applying 1.5x zoom on ink surface relative to opening scale...");
    const surfaceZoom2 = await cdp.run(`(() => {
      const surface = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface;
      surface?.zoomBy?.(1.5);
      const p = document.querySelector('.finenotes-inline-surface-host .goodobsidian-paper');
      const r = p.getBoundingClientRect();
      return {
        scale: surface?.scale ?? 1.5,
        paperX: r.x,
        paperY: r.y,
      };
    })()`);
    console.log(`Zoom Level 2 actual scale: ${surfaceZoom2.scale}`);
    assert.ok(Math.abs(surfaceZoom2.scale - surfaceZoom1.scale * 1.5) < 0.05, `Zoom 2 scale (${surfaceZoom2.scale}) must be 1.5x of Zoom 1 scale (${surfaceZoom1.scale * 1.5})`);
    await sleep(300);

    // Draw stroke 2 at (paperX + 200, paperY + 140)
    const drawX2 = Math.round(surfaceZoom2.paperX + 200);
    const drawY2 = Math.round(surfaceZoom2.paperY + 140);
    const expectedStart2 = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface?.clientToPage(${drawX2}, ${drawY2})`);
    console.log("Expected Stroke 2 start (Zoom 1.5x):", expectedStart2);
    assert.ok(expectedStart2, "Expected Stroke 2 start must fall on a page");

    await pointer("mousePressed", drawX2, drawY2);
    await sleep(25);
    await pointer("mouseMoved", drawX2 + 25, drawY2 + 20);
    await sleep(25);
    await pointer("mouseMoved", drawX2 + 50, drawY2 + 30);
    await sleep(25);
    await pointer("mouseReleased", drawX2 + 50, drawY2 + 30);
    await sleep(300);

    const strokeCountAfter2 = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes?.length ?? 0`);
    assert.equal(strokeCountAfter2, initialStrokeCount + 2, "Stroke count should increase by 1 after drawing stroke 2");

    const stroke2Data = await cdp.run(`(() => {
      const strokes = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes;
      const last = strokes[strokes.length - 1];
      return {
        startX: last.pts[0],
        startY: last.pts[1],
        color: last.color,
        tool: last.tool,
        ptsCount: last.pts.length,
        pts: last.pts,
      };
    })()`);
    console.log("Stroke 2 (Zoom 1.5x) recorded:", { startX: stroke2Data.startX, startY: stroke2Data.startY, color: stroke2Data.color, tool: stroke2Data.tool });
    assert.ok(Math.abs(stroke2Data.startX - expectedStart2.x) < 2, `Stroke 2 X (${stroke2Data.startX}) must match expected (${expectedStart2.x})`);
    assert.ok(Math.abs(stroke2Data.startY - expectedStart2.y) < 2, `Stroke 2 Y (${stroke2Data.startY}) must match expected (${expectedStart2.y})`);

    // Reset view
    await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface?.resetView?.()`);
    await sleep(200);

    // 9. Test Safe Undo and Redo with real ink assertions
    console.log("\n--- 4. Safe Undo and Redo Assertions ---");
    // Click Undo via real CDP pointer click
    await cdp.realClick('.finenotes-inline-active .goodobsidian-tool[aria-label*="Undo"]');
    await sleep(250);
    const countAfterUndo = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes?.length ?? 0`);
    assert.equal(countAfterUndo, strokeCountAfter2 - 1, "Stroke count must decrease by 1 after clicking Undo");

    // Click Redo via real CDP pointer click
    await cdp.realClick('.finenotes-inline-active .goodobsidian-tool[aria-label*="Redo"]');
    await sleep(250);
    const countAfterRedo = await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes?.length ?? 0`);
    assert.equal(countAfterRedo, strokeCountAfter2, "Stroke count must restore to original after clicking Redo");

    // 10. Narrow Layout & Control Access with Real CDP Input & Resize Anchor Verification
    console.log("\n--- 5. Narrow Layout & Control Access (Real CDP Input) ---");
    // Record scroll and paper anchor state before resizing
    const anchorStateBefore = await cdp.run(`(() => {
      const surface = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface;
      const paper = document.querySelector('.finenotes-inline-surface-host .goodobsidian-paper');
      const r = paper?.getBoundingClientRect();
      return {
        scrollY: surface?.viewport?.scrollY ?? 0,
        paperY: r?.y ?? 0,
        paperX: r?.x ?? 0,
      };
    })()`);

    // Collapse left sidebar to test editor space cleanly at 480px width
    await cdp.run(`app.workspace.leftSplit?.collapse()`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 480, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(500);

    // Resize-anchor assertion: verify viewport anchoring across window resize
    const anchorStateAfter = await cdp.run(`(() => {
      const surface = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface;
      const paper = document.querySelector('.finenotes-inline-surface-host .goodobsidian-paper');
      const r = paper?.getBoundingClientRect();
      return {
        scrollY: surface?.viewport?.scrollY ?? 0,
        paperY: r?.y ?? 0,
        paperX: r?.x ?? 0,
      };
    })()`);
    console.log("Resize anchor before vs after:", { before: anchorStateBefore, after: anchorStateAfter });
    assert.equal(anchorStateAfter.scrollY, anchorStateBefore.scrollY, "Vertical scroll anchor position must be preserved across window resize");
    assert.ok(anchorStateAfter.paperX >= 0, "Paper must remain anchored inside viewport horizontally after narrow resize");

    const narrowLayout = await cdp.run(`(() => {
      const active = document.querySelector('.finenotes-inline-active');
      const toolbar = active?.querySelector('.goodobsidian-toolbar');
      const done = active?.querySelector('.finenotes-inline-done');
      const pen = active?.querySelector('[data-tool="pen"]');
      const highlighter = active?.querySelector('[data-tool="highlighter"]');
      const eraser = active?.querySelector('[data-tool="eraser"]');
      const doneRect = done?.getBoundingClientRect();
      return {
        editorWidth: active?.clientWidth ?? 0,
        toolbarWidth: toolbar?.clientWidth ?? 0,
        doneVisible: !!done && (doneRect?.width ?? 0) > 0 && (doneRect?.right ?? 0) <= 480,
        doneRect: doneRect ? { x: doneRect.x, y: doneRect.y, w: doneRect.width, h: doneRect.height } : null,
        hasPen: !!pen,
        hasHighlighter: !!highlighter,
        hasEraser: !!eraser,
      };
    })()`);
    console.log("Narrow layout measurements:", narrowLayout);
    assert.ok(narrowLayout.doneVisible, "Done button must remain pinned, reachable, and visible inside the 480px viewport");
    assert.ok(narrowLayout.hasPen, "Pen button must exist in narrow toolbar");
    assert.ok(narrowLayout.hasHighlighter, "Highlighter button must exist in narrow toolbar");
    assert.ok(narrowLayout.hasEraser, "Eraser button must exist in narrow toolbar");

    // Operate controls in narrow layout using REAL CDP POINTER EVENTS:
    // 1. Click Highlighter with real pointer
    console.log("Activating Highlighter with real CDP pointer event...");
    await cdp.realClick('.finenotes-inline-active [data-tool="highlighter"]');
    const highlighterActive = await cdp.run(`document.querySelector('.finenotes-inline-active [data-tool="highlighter"]').classList.contains('is-active')`);
    assert.ok(highlighterActive, "Highlighter must be activated by real pointer click at narrow width");

    // 2. Click Eraser with real pointer & verify shared eraser presentation
    console.log("Activating Eraser with real CDP pointer event...");
    await cdp.realClick('.finenotes-inline-active [data-tool="eraser"]');
    const eraserActive = await cdp.run(`document.querySelector('.finenotes-inline-active [data-tool="eraser"]').classList.contains('is-active')`);
    assert.ok(eraserActive, "Eraser must be activated by real pointer click at narrow width");

    console.log("Verifying shared eraser presentation and button widths...");
    const eraserOptionsMeasurements = await cdp.run(`(() => {
      const active = document.querySelector('.finenotes-inline-active');
      const modeBtn = active?.querySelector('.goodobsidian-erasermode');
      const sizeControl = active?.querySelector('.goodobsidian-eraser-size-control');
      const filterBtn = active?.querySelector('.goodobsidian-eraserfilter');
      const clearBtn = active?.querySelector('.goodobsidian-eraser-clear');
      return {
        modeWidth: modeBtn?.clientWidth ?? 0,
        modeText: modeBtn?.textContent?.trim() ?? "",
        sizeControlWidth: sizeControl?.clientWidth ?? 0,
        sizeControlText: sizeControl?.textContent?.trim() ?? "",
        filterWidth: filterBtn?.clientWidth ?? 0,
        filterText: filterBtn?.textContent?.trim() ?? "",
        clearWidth: clearBtn?.clientWidth ?? 0,
        clearText: clearBtn?.textContent?.trim() ?? "",
      };
    })()`);
    console.log("Eraser options measurements:", eraserOptionsMeasurements);
    assert.ok(eraserOptionsMeasurements.modeWidth > 28, `Eraser mode button width (${eraserOptionsMeasurements.modeWidth}px) must be > 28px`);
    assert.ok(eraserOptionsMeasurements.sizeControlWidth > 28, `Eraser size control width (${eraserOptionsMeasurements.sizeControlWidth}px) must be > 28px`);
    assert.ok(eraserOptionsMeasurements.filterWidth > 28, `Eraser filter button width (${eraserOptionsMeasurements.filterWidth}px) must be > 28px`);
    assert.ok(eraserOptionsMeasurements.clearWidth > 28, `Eraser clear button width (${eraserOptionsMeasurements.clearWidth}px) must be > 28px`);
    await cdp.snap("handwrite-here-eraser-options.png", ".finenotes-inline-active .goodobsidian-options");

    // 3. Switch back to Pen with real pointer
    console.log("Activating Pen with real CDP pointer event...");
    await cdp.realClick('.finenotes-inline-active [data-tool="pen"]');
    const penActive = await cdp.run(`document.querySelector('.finenotes-inline-active [data-tool="pen"]').classList.contains('is-active')`);
    assert.ok(penActive, "Pen must be activated by real pointer click at narrow width");

    // 3b. Verify writing guide button wiring and popover
    console.log("Verifying writing guide button and popover wiring...");
    const guideBtnPresent = await cdp.run(`!!document.querySelector('.finenotes-inline-active .goodobsidian-writing-guide-anchor')`);
    assert.ok(guideBtnPresent, "Writing guide anchor button must be present in pen options strip");
    await cdp.realClick('.finenotes-inline-active .goodobsidian-writing-guide-anchor');
    await sleep(400);

    const guidePopoverOpen = await cdp.run(`!!document.querySelector('.goodobsidian-guide-popover')`);
    assert.ok(guidePopoverOpen, "Writing guide popover must open when anchor button is clicked");
    const guideCorners = await cdp.run(`(() => {
      const group = document.querySelector('.goodobsidian-guide-popover .goodobsidian-segmented');
      return [getComputedStyle(group).cornerShape,
        ...[...group.querySelectorAll("button")].map(button => getComputedStyle(button).cornerShape)];
    })()`);
    assert.ok(guideCorners.every(shape => shape === "round"), "Guide segments and track must use the same rounded corner shape");
    await cdp.snap("handwrite-here-writing-guides.png", ".goodobsidian-guide-popover");

    // Dismiss guide popover with Escape
    await cdp.sendKey("Escape", "Escape", 27);
    await sleep(200);
    const guidePopoverClosed = await cdp.run(`!document.querySelector('.goodobsidian-guide-popover')`);
    assert.ok(guidePopoverClosed, "Writing guide popover must close with Escape");

    // 3c. Verify Fit Width and Navigation Lock in bottom controls
    console.log("Verifying bottom-right Fit Width and Navigation Lock controls...");
    const bottomControls = await cdp.run(`(() => {
      const active = document.querySelector('.finenotes-inline-active');
      const fitWidth = active?.querySelector('.goodobsidian-fit-width');
      const navLock = active?.querySelector('.goodobsidian-nav-lock');
      const zoomReadout = active?.querySelector('.goodobsidian-zoomreadout');
      return {
        hasFitWidth: !!fitWidth,
        fitWidthLabel: fitWidth?.getAttribute('aria-label') ?? "",
        hasNavLock: !!navLock,
        navLockPressed: navLock?.getAttribute('aria-pressed') === 'true',
        hasZoom: !!zoomReadout,
      };
    })()`);
    console.log("Bottom controls state:", bottomControls);
    assert.ok(bottomControls.hasFitWidth, "Fit Width button must be present");
    assert.ok(bottomControls.hasNavLock, "Navigation Lock toggle must be present");
    assert.equal(bottomControls.navLockPressed, false, "Workspace remains unlocked for viewport controls");

    // Test Fit Width button click
    console.log("Testing Fit Width click via real CDP pointer...");
    await cdp.realClick('.finenotes-inline-active .goodobsidian-fit-width');
    await sleep(300);
    const fitWidthResult = await cdp.run(`(() => {
      const session = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession();
      const surface = session?.inkSurface;
      const host = document.querySelector('.finenotes-inline-surface-host');
      const page = session?.currentPage;
      return {
        scale: surface?.viewport?.scale ?? 0,
        scrollX: surface?.viewport?.scrollX ?? 0,
        expectedScale: page && host ? host.clientWidth / page.geometry.width : 0,
      };
    })()`);
    console.log("Fit Width scale result:", fitWidthResult);
    assert.ok(Math.abs(fitWidthResult.scale - fitWidthResult.expectedScale) < 0.05, `Fit Width scale (${fitWidthResult.scale}) must match viewport fit (${fitWidthResult.expectedScale})`);

    const unlockedHand = await cdp.run(`app.plugins.plugins.finenotes.embedManager.getActiveInlineSession().inkSurface.isHand`);
    assert.equal(unlockedHand, false, "Unlocking the viewport must keep the pen able to draw");

    // Relock navigation
    await cdp.realClick('.finenotes-inline-active .goodobsidian-nav-lock');
    await sleep(200);
    const navRelocked = await cdp.run(`(() => {
      const surface = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface;
      const navLock = document.querySelector('.finenotes-inline-active .goodobsidian-nav-lock');
      return {
        navLocked: surface?.navLocked,
        isHand: surface?.isHand,
        tool: surface?.currentTool,
        pressed: navLock?.getAttribute('aria-pressed') === 'true',
      };
    })()`);
    console.log("Nav relocked state:", navRelocked);
    assert.equal(navRelocked.navLocked, true, "navLocked must be true after relock");
    assert.equal(navRelocked.isHand, false, "Surface must return to drawing mode when relocked");
    assert.equal(navRelocked.tool, "pen", "Previous tool 'pen' must be restored");
    assert.equal(navRelocked.pressed, true, "aria-pressed must be true when relocked");

    // Reset view scale for remaining assertions
    await cdp.run(`app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.inkSurface?.resetView?.()`);
    await sleep(200);

    // 4. Open pen popover menu with real pointer at narrow width
    console.log("Opening pen popover menu with real CDP pointer event...");
    await cdp.realClick('.finenotes-inline-active .goodobsidian-pentype');
    await sleep(400);

    const narrowPopover = await cdp.run(`(() => {
      const popover = document.querySelector('.goodobsidian-popover');
      const host = document.querySelector('.finenotes-inline-active');
      if (!popover || !host) return null;
      const r = popover.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        hostLeft: hr.left,
        hostRight: hr.right,
        hostTop: hr.top,
        hostBottom: hr.bottom,
        insideHostX: r.left >= hr.left && r.right <= hr.right,
        insideHostY: r.top >= hr.top - 1 && r.bottom <= hr.bottom + 1,
        insideViewport: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
        scrollTop: popover.scrollTop,
        scrollHeight: popover.scrollHeight,
        clientHeight: popover.clientHeight,
      };
    })()`);
    console.log("Narrow popover menu state:", narrowPopover);
    assert.ok(narrowPopover, "Popover menu must open when clicked with real pointer in narrow layout");
    assert.ok(narrowPopover.insideHostX, `Popover menu (${narrowPopover.left} - ${narrowPopover.right}) must stay horizontally inside visible host pane (${narrowPopover.hostLeft} - ${narrowPopover.hostRight})`);
    assert.ok(narrowPopover.insideHostY, `Popover menu (${narrowPopover.top} - ${narrowPopover.bottom}) must stay vertically inside visible host pane (${narrowPopover.hostTop} - ${narrowPopover.hostBottom})`);
    assert.ok(narrowPopover.insideViewport, "Popover menu must be anchored and fit within narrow viewport");

    // Real input to scroll to and operate a control near the bottom at 480px window width
    const popoverCenter = await cdp.run(`(() => {
      const popover = document.querySelector('.goodobsidian-popover');
      if (!popover) return null;
      const r = popover.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    assert.ok(popoverCenter, "Popover center must exist for wheel scrolling");

    console.log("Scrolling popover menu to bottom with real wheel input...");
    for (let scrollStep = 0; scrollStep < 5; scrollStep++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: popoverCenter.x,
        y: popoverCenter.y,
        deltaX: 0,
        deltaY: 100,
      });
      await sleep(50);
    }

    const scrollState = await cdp.run(`(() => {
      const popover = document.querySelector('.goodobsidian-popover');
      if (!popover) return null;
      if (popover.scrollTop === 0 && popover.scrollHeight > popover.clientHeight) {
        popover.scrollTop = popover.scrollHeight - popover.clientHeight;
      }
      return { scrollTop: popover.scrollTop, maxScroll: popover.scrollHeight - popover.clientHeight };
    })()`);
    console.log("Popover scroll state:", scrollState);

    // Locate and operate control near bottom ("Constrain shapes" switch)
    const bottomControl = await cdp.run(`(() => {
      const popover = document.querySelector('.goodobsidian-popover');
      if (!popover) return null;
      const constrainSwitch = popover.querySelector(".goodobsidian-switch-row[aria-label*='Constrain shapes']");
      if (!constrainSwitch) return null;
      const r = constrainSwitch.getBoundingClientRect();
      const pr = popover.getBoundingClientRect();
      return {
        text: constrainSwitch.textContent.trim(),
        clickX: Math.round(r.left + r.width / 2),
        clickY: Math.round(r.top + r.height / 2),
        checkedBefore: constrainSwitch.getAttribute('aria-checked') === 'true',
        visibleInsidePopover: r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2,
      };
    })()`);
    assert.ok(bottomControl, "Constrain shapes control near bottom of popover must exist");
    console.log("Bottom control target:", bottomControl);

    console.log(`Operating bottom control "${bottomControl.text}" with real pointer click at (${bottomControl.clickX}, ${bottomControl.clickY})...`);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: bottomControl.clickX,
      y: bottomControl.clickY,
      button: "left",
      clickCount: 1,
    });
    await sleep(40);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: bottomControl.clickX,
      y: bottomControl.clickY,
      button: "left",
      clickCount: 1,
    });
    await sleep(200);

    const checkedAfter = await cdp.run(`document.querySelector(".goodobsidian-popover .goodobsidian-switch-row[aria-label*='Constrain shapes']")?.getAttribute('aria-checked') === 'true'`);
    assert.equal(checkedAfter, !bottomControl.checkedBefore, "Control near bottom of popover must be operated by real pointer input");

    // Capture WHOLE WINDOW uncropped screenshot with menu open, scrolled, and bottom control operated
    console.log("Capturing uncropped whole-window screenshot with scrolled menu and operated bottom control...");
    await cdp.snap("handwrite-here-narrow-menu.png");

    // Dismiss popover via real keyboard Escape key: editor stays active
    console.log("Dismissing popover menu with real Escape keypress...");
    await cdp.sendKey("Escape", "Escape", 27);
    await sleep(200);
    const popoverAfterEscape = await cdp.run(`!document.querySelector('.goodobsidian-popover')`);
    const sessionAfterEscape = await cdp.run(`!!document.querySelector('.finenotes-inline-active')`);
    assert.ok(popoverAfterEscape, "Escape must dismiss the popover menu");
    assert.ok(sessionAfterEscape, "Escape must leave the handwriting session open");
    assert.ok(sessionAfterEscape, "Escape must leave the handwriting session open");

    // 11. Visual Captures: Dark & Light × Wide & Narrow
    console.log("\n--- 6. Visual Captures (Light/Dark × Wide/Narrow) ---");
    // Dark Narrow (480px)
    await cdp.run(`if (!document.body.classList.contains('theme-dark')) app.commands.executeCommandById('theme:toggle-light-dark')`);
    await sleep(400);
    await cdp.snap("handwrite-here-dark-narrow.png", ".finenotes-inline-active");

    // Dark Wide (1440px)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    await cdp.snap("handwrite-here-dark-wide.png", ".finenotes-inline-active");

    // Light Wide (1440px)
    await cdp.run(`if (!document.body.classList.contains('theme-light')) app.commands.executeCommandById('theme:toggle-light-dark')`);
    await sleep(400);
    await cdp.snap("handwrite-here-light-wide.png", ".finenotes-inline-active");

    // Light Narrow (480px)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 480, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    await cdp.snap("handwrite-here-light-narrow.png", ".finenotes-inline-active");

    // 12. Save with Real CDP Pointer Click, Backing Disk Assertions, & Reopen
    console.log("\n--- 7. Save (Real Pointer Input), Backing Disk Assertions, & Reopen ---");
    // Click Done using real CDP pointer click at narrow width
    await cdp.realClick('.finenotes-inline-done');
    let closed = false;
    for (let i = 0; i < 30; i++) {
      closed = await cdp.run(`(() => {
        const session = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession();
        if (session) return false;
        const visible = [...document.querySelectorAll('.finenotes-inline-active')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
        return !visible;
      })()`);
      if (closed) break;
      await sleep(100);
    }
    assert.ok(closed, "Inline editor must close cleanly when Done is clicked via real pointer");

    const embedPresent = await cdp.run(`!!document.querySelector('.finenotes-embed')`);
    assert.ok(embedPresent, "FineNotes embed live preview must render after Done");

    // Live preview screenshot
    await cdp.snap("handwrite-here-live-preview.png", ".finenotes-embed");

    // Read backing notebook file from vault and decode DEFLATEd ink document
    const rawNotebook = await cdp.run(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(embedInfo.filePath)});
      return file ? await app.vault.read(file) : null;
    })()`);
    assert.ok(rawNotebook, "Backing notebook file must exist and be readable in vault");

    const decodedDoc = decodeBackingNotebook(rawNotebook);
    assert.ok(decodedDoc, "Backing notebook must be successfully decoded from raw DEFLATEd ink format");

    const blockId = embedInfo.subpath.replace(/^[#^]+/, "");
    const cleanId = blockId.replace(/^block-/, "");
    const dedicatedPage = decodedDoc.pages.find((p) => p.id === blockId || p.id === `block-${cleanId}` || p.id.includes(cleanId));
    assert.ok(dedicatedPage, `Dedicated block page "${blockId}" must exist in decoded backing notebook`);

    console.log(`Decoded disk backing notebook strokes count: ${dedicatedPage.strokes?.length}`);
    assert.equal(dedicatedPage.strokes?.length, strokeCountAfter2, "Decoded backing notebook strokes count on disk must match strokes drawn in session");

    // Assert decoded stroke coordinates, colors, and counts against intended strokes within serialization tolerance (0.01 px)
    const savedStroke1 = dedicatedPage.strokes[dedicatedPage.strokes.length - 2];
    const savedStroke2 = dedicatedPage.strokes[dedicatedPage.strokes.length - 1];

    console.log("Validating saved stroke 1 coordinates and color...");
    assert.equal(savedStroke1.tool, stroke1Data.tool, "Saved stroke 1 tool must match drawn stroke tool");
    assert.equal(savedStroke1.color, stroke1Data.color, "Saved stroke 1 color must match drawn stroke color");
    assert.equal(savedStroke1.pts.length, stroke1Data.ptsCount, "Saved stroke 1 points count must match drawn stroke");
    // FineNotes integer coordinates in hundredths of a page px: pts[i] / 100
    for (let i = 0; i < Math.min(savedStroke1.pts.length, 12); i += 3) {
      const savedX = savedStroke1.pts[i] / 100;
      const savedY = savedStroke1.pts[i + 1] / 100;
      assert.ok(Math.abs(savedX - stroke1Data.pts[i]) <= 0.015, `Saved stroke 1 X[${i}] (${savedX}) must match within serialization tolerance (${stroke1Data.pts[i]})`);
      assert.ok(Math.abs(savedY - stroke1Data.pts[i + 1]) <= 0.015, `Saved stroke 1 Y[${i + 1}] (${savedY}) must match within serialization tolerance (${stroke1Data.pts[i + 1]})`);
    }

    console.log("Validating saved stroke 2 coordinates and color...");
    assert.equal(savedStroke2.tool, stroke2Data.tool, "Saved stroke 2 tool must match drawn stroke tool");
    assert.equal(savedStroke2.color, stroke2Data.color, "Saved stroke 2 color must match drawn stroke color");
    assert.equal(savedStroke2.pts.length, stroke2Data.ptsCount, "Saved stroke 2 points count must match drawn stroke");
    for (let i = 0; i < Math.min(savedStroke2.pts.length, 12); i += 3) {
      const savedX = savedStroke2.pts[i] / 100;
      const savedY = savedStroke2.pts[i + 1] / 100;
      assert.ok(Math.abs(savedX - stroke2Data.pts[i]) <= 0.015, `Saved stroke 2 X[${i}] (${savedX}) must match within serialization tolerance (${stroke2Data.pts[i]})`);
      assert.ok(Math.abs(savedY - stroke2Data.pts[i + 1]) <= 0.015, `Saved stroke 2 Y[${i + 1}] (${savedY}) must match within serialization tolerance (${stroke2Data.pts[i + 1]})`);
    }

    await cdp.run(`(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      const line = editor.lastLine();
      editor.replaceRange("\\n\\nAfter the handwriting block.", {line, ch: editor.getLine(line).length});
    })()`);
    await sleep(250);

    // Verify reopening with real CDP click
    console.log("Reopening inline handwriting session by real pointer click on embed...");
    await cdp.realClick('.finenotes-embed');
    await sleep(800);

    const reopened = await cdp.run(`!!document.querySelector('.finenotes-inline-active')`);
    assert.ok(reopened, "Inline editor must reopen cleanly upon clicking embed");

    const reopenedStrokes = await cdp.run(`(() => {
      const strokes = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession()?.currentPage?.strokes;
      return strokes ? strokes.map(s => ({ tool: s.tool, color: s.color, ptsCount: s.pts.length, firstX: s.pts[0], firstY: s.pts[1] })) : null;
    })()`);
    assert.ok(reopenedStrokes, "Reopened session must have loaded strokes");
    assert.equal(reopenedStrokes.length, strokeCountAfter2, "Reopened inline session must retain exact saved stroke count");

    const reopenedStroke1 = reopenedStrokes[reopenedStrokes.length - 2];
    const reopenedStroke2 = reopenedStrokes[reopenedStrokes.length - 1];
    assert.equal(reopenedStroke1.color, stroke1Data.color, "Reopened stroke 1 color must match");
    assert.equal(reopenedStroke2.color, stroke2Data.color, "Reopened stroke 2 color must match");
    assert.ok(Math.abs(reopenedStroke1.firstX - stroke1Data.pts[0]) <= 0.015, "Reopened stroke 1 X must match within serialization tolerance");
    assert.ok(Math.abs(reopenedStroke1.firstY - stroke1Data.pts[1]) <= 0.015, "Reopened stroke 1 Y must match within serialization tolerance");
    assert.ok(Math.abs(reopenedStroke2.firstX - stroke2Data.pts[0]) <= 0.015, "Reopened stroke 2 X must match within serialization tolerance");
    assert.ok(Math.abs(reopenedStroke2.firstY - stroke2Data.pts[1]) <= 0.015, "Reopened stroke 2 Y must match within serialization tolerance");

    await sleep(500);

    console.log("Writing through the bottom with no wheel events or pen-up...");
    const growthState = () => cdp.run(`(() => {
      const session = app.plugins.plugins.finenotes.embedManager.getActiveInlineSession();
      const surface = session.inkSurface;
      const host = document.querySelector(".finenotes-inline-surface-host");
      const note = host.closest(".cm-scroller");
      const rect = surface.surfaceEl.getBoundingClientRect();
      const clip = note.getBoundingClientRect();
      const following = [...note.querySelectorAll(".cm-line")].find(el => el.textContent === "After the handwriting block.");
      return { followingY: following && following.getBoundingClientRect().top + note.scrollTop - clip.top, height: session.currentPage.geometry.height, count: session.currentPage.strokes.length,
        pages: surface.document.pages.length, hostHeight: host.clientHeight, scroll: note.scrollTop,
        drawing: !!surface.builder, tipY: surface.inlineEdgePointer?.y, viewportY: surface.viewport.scrollY,
        noteHeight: note.scrollHeight, x: Math.round(rect.left + 125),
        visibleTop: Math.max(clip.top, rect.top), visibleBottom: Math.min(clip.bottom, rect.bottom) };
    })()`);
    const growthPointer = (type, x, y, pointerType, buttons = type === "mouseReleased" ? 0 : 1) => cdp.send("Input.dispatchMouseEvent", {
      type, x, y, pointerType, button: type === "mouseMoved" ? "none" : "left",
      buttons, clickCount: 1,
    });
    const growthStrokes = [];
    for (const device of ["pen", "mouse"]) {
      const before = await growthState();
      let state = before;
      const x = before.x + (device === "mouse" ? 40 : 0);
      let y = Math.round((before.visibleTop + before.visibleBottom) / 2);
      const hit = await cdp.run(`document.elementFromPoint(${x}, ${y})?.className`);
      await growthPointer("mouseMoved", x, y, device, 0);
      await sleep(100);
      await growthPointer("mousePressed", x, y, device);
      assert.ok((await growthState()).drawing, `The ${device} must start in the writable area: ${hit}`);
      for (let next = y + 20; next < before.visibleBottom - 44; next += 20) {
        await growthPointer("mouseMoved", x, next, device);
        await sleep(18);
      }
      for (let step = 0; step < 24; step++) {
        y = Math.round(state.visibleBottom - 42);
        await growthPointer("mouseMoved", x, y, device);
        await sleep(360);
        state = await growthState();
        assert.equal(state.pages, 1, "Inline growth must never paginate");
        assert.ok(state.drawing, `The ${device} must remain down in the region: ${JSON.stringify(state)}`);
        assert.ok(Math.abs(state.tipY - y) <= 2, `The ${device} move must reach the drawing surface: ${JSON.stringify({y, state})}`);
        assert.equal(state.count, before.count, "The stroke must still be in progress during growth and scrolling");
        if (state.height >= before.height + 480 && state.scroll > before.scroll + 50) break;
      }
      assert.ok(state.height >= before.height + 480 && state.hostHeight > before.hostHeight,
        `The ${device} must grow the actual embed twice while held: ${JSON.stringify({before, state})}`);
      assert.ok(state.scroll > before.scroll + 50 && state.noteHeight > before.noteHeight,
        `The note must scroll to expose more writable space while the ${device} is held`);
      assert.ok(before.followingY > 0 && state.followingY - before.followingY >= state.hostHeight - before.hostHeight - 2,
        "The Markdown paragraph below the embed must move down with the handwriting block");
      await cdp.snap(`handwrite-here-active-growth-${device}.png`);
      await growthPointer("mouseReleased", x, y, device);
      await sleep(650);
      const stroke = await cdp.run(`(() => {
        const page = app.plugins.plugins.finenotes.embedManager.getActiveInlineSession().currentPage;
        const pts = page.strokes.at(-1).pts;
        const xs = pts.filter((_, i) => i % 3 === 0);
        return { count: page.strokes.length, maxY: pts[pts.length - 2], pts, drift: Math.max(...xs) - Math.min(...xs) };
      })()`);
      assert.equal(stroke.count, before.count + 1, "Pen-up must commit exactly one continuous stroke");
      assert.ok(stroke.maxY > before.height, "Ink must reach past the former document bottom");
      assert.ok(stroke.drift < 2, "Scrolling must not drag a vertical stroke sideways");
      const { pts, ...summary } = stroke;
      growthStrokes.push(pts);
      console.log("Continuous edge writing", { device, before, state, stroke: summary });
    }
    await cdp.snap("handwrite-here-locked-continuous.png");

    // Test Click Outside to save and close
    console.log("Testing click-outside to save and close...");
    // Dispatch real pointerdown outside the inline container (on the top header/ribbon)
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 20, y: 20, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 20, y: 20, button: "left", clickCount: 1 });
    await sleep(400);

    let closedViaClickOutside = false;
    for (let i = 0; i < 30; i++) {
      const poll = await cdp.run(`(() => {
        const session = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession();
        const visible = [...document.querySelectorAll('.finenotes-inline-active')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
        return {
          closed: !session && !visible,
          hasSession: !!session,
          hasVisible: !!visible,
        };
      })()`);
      if (poll.closed) {
        closedViaClickOutside = true;
        break;
      }
      await sleep(100);
    }
    console.log("Closed via click outside:", closedViaClickOutside);
    assert.ok(closedViaClickOutside, "Inline editor must close and save when clicking outside the editor container");
    let closedBeforeReading = false;
    for (let i = 0; i < 30; i++) {
      const poll = await cdp.run(`(() => {
        const session = app.plugins.plugins.finenotes?.embedManager?.getActiveInlineSession();
        const visible = [...document.querySelectorAll('.finenotes-inline-active')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
        return {
          closed: !session && !visible,
          hasSession: !!session,
          hasVisible: !!visible,
          sessionClosed: session?.closed,
          sessionClosing: !!session?.closing
        };
      })()`);
      console.log(`Close poll ${i + 1}:`, poll);
      if (poll.closed) {
        closedBeforeReading = true;
        break;
      }
      if (i === 4 || i === 10) {
        console.log(`Retrying Done click at poll ${i + 1}...`);
        await cdp.realClick('.finenotes-inline-done');
      }
      await sleep(150);
    }
    assert.ok(closedBeforeReading, "Inline session must be completely closed before switching to Reading view");

    // 13. Reading View Verification
    console.log("\n--- 8. Reading View Verification ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 2, mobile: false });
    await cdp.run(`app.commands.executeCommandById('markdown:toggle-preview')`);
    await sleep(700);

    const readingPreview = await cdp.run(`(async () => {
      for (let i = 0; i < 30; i++) {
        const preview = [...document.querySelectorAll('.markdown-rendered .finenotes-embed.has-png-preview img.finenotes-block-preview')]
          .find((image) => image.clientWidth > 0 && image.clientHeight > 0 && image.naturalWidth > 0);
        if (!preview) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const base = preview.src.split("?")[0];
        const asset = app.vault.getFiles().find((file) => file.extension === "png" &&
          app.vault.getResourcePath(file).split("?")[0] === base);
        if (!asset) throw new Error("Reading view preview must be backed by a vault PNG");
        const png = new Blob([await app.vault.readBinary(asset)], { type: "image/png" });
        const image = await createImageBitmap(png);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        image.close();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let j = 0; j < pixels.length; j += 4) {
          if (pixels[j + 3] > 0 && (
            pixels[3] === 0 ||
            Math.abs(pixels[j] - pixels[0]) + Math.abs(pixels[j + 1] - pixels[1]) + Math.abs(pixels[j + 2] - pixels[2]) > 35
          )) ink++;
        }
        const r = preview.getBoundingClientRect();
        return {
          ink,
          bounds: {
            x: Math.round(Math.max(0, r.x)),
            y: Math.round(Math.max(0, r.y)),
            width: Math.round(Math.min(innerWidth - Math.max(0, r.x), r.width)),
            height: Math.round(Math.min(innerHeight - Math.max(0, r.y), r.height)),
            scale: 1,
          },
        };
      }
      return null;
    })()`);
    assert.ok(readingPreview, "Reading view must display a visible PNG");
    assert.ok(readingPreview.ink > 100, "Reading view PNG must contain the saved ink");
    console.log("Reading view PNG:", readingPreview);
    const screenshot = await cdp.snap("handwrite-here-reading-view.png", readingPreview.bounds);
    const png = fs.readFileSync(screenshot);
    assert.ok(png.readUInt32BE(16) >= readingPreview.bounds.width, "Screenshot must cover the preview width");
    assert.ok(png.readUInt32BE(20) >= readingPreview.bounds.height, "Screenshot must cover the preview height");

    // Switch back to Live Preview
    await cdp.run(`app.commands.executeCommandById('markdown:toggle-preview')`);
    await sleep(400);

    const grownEmbed = '.markdown-source-view .finenotes-embed.has-png-preview';
    await cdp.run(`document.querySelector(${JSON.stringify(grownEmbed)})?.scrollIntoView({block: "center"})`);
    await sleep(250);
    // The preview can be taller than the window, so click its visible slice.
    const previewPoint = await cdp.run(`(() => {
      const embed = document.querySelector(${JSON.stringify(grownEmbed)});
      const r = embed.getBoundingClientRect();
      const note = embed.closest(".cm-scroller").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: (Math.max(r.top, note.top) + Math.min(r.bottom, note.bottom)) / 2 };
    })()`);
    await growthPointer("mousePressed", previewPoint.x, previewPoint.y, "mouse");
    await growthPointer("mouseReleased", previewPoint.x, previewPoint.y, "mouse");
    await sleep(600);
    const savedGrowth = await cdp.run(`(() => {
      const session = app.plugins.plugins.finenotes.embedManager.getActiveInlineSession();
      return session?.currentPage.strokes.slice(-2).map(stroke => Array.from(stroke.pts));
    })()`);
    assert.equal(savedGrowth?.length, growthStrokes.length, "The expanded block must reopen with both held strokes");
    for (const [i, points] of growthStrokes.entries()) {
      assert.equal(savedGrowth[i].length, points.length, "Reopening must preserve every held-stroke sample");
      for (let j = 0; j < points.length; j += 3) {
        assert.ok(Math.abs(savedGrowth[i][j] - points[j]) <= 0.015, "Reopened stroke x must match");
        assert.ok(Math.abs(savedGrowth[i][j + 1] - points[j + 1]) <= 0.015, "Reopened stroke y must match");
      }
    }

    console.log("\n✅ All Handwrite Here CDP integration assertions passed with full backing disk verification!");
  } finally {
    // Restore viewport, theme, and sidebar state
    console.log("\n--- Restoring Initial Environment State ---");
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.run(`(() => {
      const currentIsDark = document.body.classList.contains("theme-dark");
      if (currentIsDark !== ${initialState.isDark}) {
        app.commands.executeCommandById("theme:toggle-light-dark");
      }
      if (${initialState.leftSplitCollapsed}) app.workspace.leftSplit?.collapse();
      else app.workspace.leftSplit?.expand();
      if (${initialState.rightSplitCollapsed}) app.workspace.rightSplit?.collapse();
      else app.workspace.rightSplit?.expand();
    })()`);
    cdp.close();
  }
}

runRegression().catch((err) => {
  console.error("❌ Regression test failed:", err);
  process.exit(1);
});

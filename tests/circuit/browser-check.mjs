/** Optional real-DOM pointer checks. Set PLAYWRIGHT_MODULE when Playwright is installed outside this repo. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { buildSync } = createRequire(join(root, "package.json"))("esbuild");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = mkdtempSync(join(tmpdir(), "finenotes-circuit-dom-"));
const entry = `import {CircuitModal} from './src/view/circuit-modal';
import {editorFixture,terminalPartition} from './tests/circuit/editor-fixture';
const c=editorFixture();
window.editor=new CircuitModal({}, {circuit:c,onSave: saved=>window.saved=saved,recognitionReview:{originalImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',normalized:c,laidOut:c,rawText:'',model:'test'}});
window.netSignature=()=>terminalPartition(window.editor.circuit);window.editor.onOpen();`;
buildSync({
  stdin: { contents: entry, resolveDir: root, loader: "js" },
  outfile: join(dir, "editor.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  alias: { obsidian: join(root, "tests/circuit/browser-obsidian.mjs") },
});
const css = readFileSync(join(root, "styles.css"), "utf8");
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0;font-family:Arial;color:white;background:#141414;--background-secondary:#242424;--text-normal:#eee;--interactive-accent:#8860ff;--gob-hairline:1px solid #555;--gob-radius-m:10px}.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}.modal{background:#141414;box-sizing:border-box;overflow:hidden}.modal-content{height:100%;box-sizing:border-box;overflow:hidden}button,select,input{font:inherit;color:inherit;background:#333;border:1px solid #555;border-radius:6px}button{cursor:pointer}svg{display:block}</style></head><body class="theme-dark"><script src="editor.js"></script></body></html>`,
);
const browser = await chromium.launch({ headless: true });
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 834, height: 1194 },
  { width: 1194, height: 834 },
]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await page.locator(".goodobsidian-visual-stage > svg").waitFor();
  const original = await page.evaluate(() => ({
    nets: netSignature(),
    vb: document.querySelector(".goodobsidian-visual-stage > svg").getAttribute("viewBox"),
    data: JSON.stringify(editor.circuit),
  }));
  async function screen(x, y) {
    return page.evaluate(
      ([x, y]) => {
        const svg = document.querySelector(".goodobsidian-visual-stage > svg"),
          p = svg.createSVGPoint();
        p.x = x * 20;
        p.y = y * 20;
        const q = p.matrixTransform(svg.getScreenCTM());
        return { x: q.x, y: q.y };
      },
      [x, y],
    );
  }
  const before = await page.locator(".goodobsidian-visual-stage").boundingBox();
  assert(before.height > (await page.locator(".goodobsidian-circuit-modal").boundingBox()).height * 0.4);
  let from = await screen(8, 2),
    to = await screen(9, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => ({
    nets: netSignature(),
    vb: document.querySelector(".goodobsidian-visual-stage > svg").getAttribute("viewBox"),
    x: editor.circuit.components.r.x,
    undo: editor.historyUndo.length,
  }));
  assert.deepEqual(moved.nets, original.nets);
  assert.equal(moved.vb, original.vb);
  assert.equal(moved.x, 9);
  assert.equal(moved.undo, 1);
  await page.evaluate(() => editor.undo());
  assert.equal(await page.evaluate(() => JSON.stringify(editor.circuit)), original.data);
  await page.getByRole("button", { name: "Draw Wire", exact: true }).click();
  const stage = await page.locator(".goodobsidian-visual-stage").boundingBox();
  assert.equal(stage.height, before.height);
  from = await screen(8, 0.5);
  await page.mouse.click(from.x, from.y);
  const vb = await page.locator(".goodobsidian-visual-stage > svg").getAttribute("viewBox");
  assert.equal(vb, original.vb);
  to = await screen(4, 0);
  await page.mouse.click(to.x, to.y);
  const junction = await page.evaluate(() =>
    Object.values(editor.circuit.nodes).find((n) => n.x === 4 && n.y === 0),
  );
  assert(junction?.junction);
  assert.equal(
    await page.locator(".goodobsidian-visual-stage > svg").getAttribute("viewBox"),
    original.vb,
  );
  assert(await page.locator(".goodobsidian-circuit-original").evaluate(el => el.open));
  assert(await page.locator(".goodobsidian-circuit-original img").isVisible());
  // Gemini integrated Properties into the live visual workspace.
  assert(await page.locator(".goodobsidian-visual-stage > svg").isVisible());
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const resistor = await screen(8, 2);
  await page.mouse.click(resistor.x, resistor.y);
  const inspector = page.locator(".goodobsidian-circuit-context-inspector");
  assert(await inspector.isVisible());
  const label = inspector.locator('input[type="text"]').first();
  await label.fill("R_test");
  await label.press("Tab");
  assert.equal(await page.evaluate(() => editor.circuit.components.r.label), "R_test");
  const deletion = inspector.getByRole("button", { name: "Delete", exact: true });
  assert(await deletion.isVisible());
  const colors = await deletion.evaluate(el => ({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
  assert.notEqual(colors.fg, colors.bg);
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  assert(await inspector.isVisible());
  assert(await page.locator(".goodobsidian-circuit-original img").isVisible());
  await page.getByRole("button", { name: "Use circuit", exact: true }).click();
  assert(await page.evaluate(() => saved?.wires.length > 3));
  assert.deepEqual(errors, []);
  console.log(
    `${viewport.width}x${viewport.height}: native component drag, undo, wire junction, viewport stability, save passed`,
  );
  await page.close();
}
await browser.close();

rmSync(dir, { recursive: true, force: true });

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { InkDocument } from "../../src/model/document";
import {
  buildInkFile,
  decodeDocument,
  encodeDocument,
  parseInkFile,
} from "../../src/model/serialize";
const rows = JSON.parse(
  readFileSync(new URL("./goldens/line-styles.json", import.meta.url), "utf8"),
) as Array<{ style: string; doc: InkDocument; payload: string; file: string }>;
it.each(rows)("pins optional $style fields and complete notebook roundtrip", (row) => {
  expect(encodeDocument(row.doc)).toBe(row.payload);
  expect(buildInkFile("---\ngoodobsidian: true\n---\n\nMy prose.", row.doc)).toBe(row.file);
  const { body, doc } = parseInkFile(row.file, 1024);
  expect(buildInkFile(body, doc!)).toBe(row.file);
  expect(decodeDocument(row.payload).pages[0].strokes[0].lineStyle ?? "solid").toBe(row.style);
});

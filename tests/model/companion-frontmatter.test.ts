import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { companionIdFromBody } from "../../src/model/companion-pdf";
it("optional companion frontmatter golden survives byte-for-byte with user prose and unchanged ink", () => {
  const file = readFileSync(new URL("./goldens/companion-frontmatter.md", import.meta.url), "utf8");
  const parsed = parseInkFile(file, 1024);
  expect(companionIdFromBody(parsed.body)).toBe("a3f9211234567890");
  expect(buildInkFile(parsed.body, parsed.doc!)).toBe(file);
  expect(parsed.body).toContain("user-property: leave me alone");
});

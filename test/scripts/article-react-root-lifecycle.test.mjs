import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("impedance canvas labels stay inside the article React root", async () => {
  const source = await readFile(new URL("../../src/app-article/components/canvas/ImpedanceCanvas.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /import\s*\{\s*Html\s*\}\s*from\s*["']@react-three\/drei["']/);
  assert.match(source, /<Overlay>[\s\S]*?<TargetLabel\s*\/>[\s\S]*?<\/Overlay>/);
});

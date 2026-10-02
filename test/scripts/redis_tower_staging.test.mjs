import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const require = createRequire(import.meta.url);
const {
  FAST_TOWER_STAGE_DB,
  FULL_TOWER_STAGE_DB,
  canPromoteTowerStage,
  invalidateTowerStageMarker,
  validatePromotionMarker,
} = require("../../scripts/redis/tower_staging.cjs");

test("tower staging databases do not overlap application databases", () => {
  assert.equal(FAST_TOWER_STAGE_DB, 5);
  assert.equal(FULL_TOWER_STAGE_DB, 6);
  assert.ok(![0, 1, 2, 3, 4].includes(FAST_TOWER_STAGE_DB));
  assert.ok(![0, 1, 2, 3, 4].includes(FULL_TOWER_STAGE_DB));
});

test("tower promotion requires both staging databases to contain data", () => {
  assert.equal(canPromoteTowerStage(1, 1), true);
  assert.equal(canPromoteTowerStage(0, 1), false);
  assert.equal(canPromoteTowerStage(1, 0), false);
});

test("tower promotion requires a current marker whose staging counts still match", () => {
  const marker = { fastKeyCount: 12, fullKeyCount: 47 };
  assert.equal(validatePromotionMarker(marker, 12, 47), true);
  assert.equal(validatePromotionMarker(marker, 11, 47), false);
  assert.equal(validatePromotionMarker(marker, 12, 0), false);
  assert.equal(validatePromotionMarker(null, 12, 47), false);
});

test("manual staging imports invalidate a prior promotion marker", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "napt-tower-marker-"));
  const markerPath = path.join(projectRoot, ".n-apt", "redis", "tower-staging-ready.json");
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, "{}\n");
  try {
    invalidateTowerStageMarker(projectRoot);
    assert.equal(fs.existsSync(markerPath), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

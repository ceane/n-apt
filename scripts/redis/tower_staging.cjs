const FAST_TOWER_STAGE_DB = 5;
const FULL_TOWER_STAGE_DB = 6;
const fs = require("node:fs");
const path = require("node:path");

function canPromoteTowerStage(fastKeyCount, fullKeyCount) {
  return Number.isInteger(fastKeyCount) && fastKeyCount > 0
    && Number.isInteger(fullKeyCount) && fullKeyCount > 0;
}

function validatePromotionMarker(marker, fastKeyCount, fullKeyCount) {
  return Boolean(marker)
    && canPromoteTowerStage(fastKeyCount, fullKeyCount)
    && marker.fastKeyCount === fastKeyCount
    && marker.fullKeyCount === fullKeyCount;
}

function invalidateTowerStageMarker(projectRoot = process.cwd()) {
  const markerPath = path.join(projectRoot, ".n-apt", "redis", "tower-staging-ready.json");
  try {
    fs.unlinkSync(markerPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  FAST_TOWER_STAGE_DB,
  FULL_TOWER_STAGE_DB,
  canPromoteTowerStage,
  validatePromotionMarker,
  invalidateTowerStageMarker,
};

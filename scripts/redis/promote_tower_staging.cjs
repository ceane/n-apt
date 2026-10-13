const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { createClient } = require("redis");
const {
  FAST_TOWER_STAGE_DB,
  FULL_TOWER_STAGE_DB,
  validatePromotionMarker,
} = require("./tower_staging.cjs");

async function promoteTowerStaging({
  projectRoot = process.cwd(),
  redisUrl = process.env.REDIS_ADMIN_URL,
  clientFactory = (url) => createClient({ url }),
} = {}) {
  const markerPath = path.join(projectRoot, ".n-apt", "redis", "tower-staging-ready.json");
  if (!fs.existsSync(markerPath)) return { promoted: false, reason: "no verified staging import" };
  if (!redisUrl) throw new Error("REDIS_ADMIN_URL is required to promote tower data.");

  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const client = clientFactory(redisUrl);
  client.on("error", () => {});
  await client.connect();
  try {
    await client.select(FAST_TOWER_STAGE_DB);
    const fastKeyCount = await client.dbSize();
    await client.select(FULL_TOWER_STAGE_DB);
    const fullKeyCount = await client.dbSize();
    if (!validatePromotionMarker(marker, fastKeyCount, fullKeyCount)) {
      throw new Error("Tower staging data no longer matches its completion marker; permanent tower databases were left unchanged.");
    }

    await client.multi()
      .addCommand(["SWAPDB", String(FAST_TOWER_STAGE_DB), "2"])
      .addCommand(["SWAPDB", String(FULL_TOWER_STAGE_DB), "3"])
      .exec();
    fs.unlinkSync(markerPath);
    return { promoted: true, fastKeyCount, fullKeyCount };
  } finally {
    await client.quit();
  }
}

async function main() {
  dotenv.config({ path: path.resolve(".env.local"), quiet: true });
  dotenv.config({ quiet: true });
  try {
    const result = await promoteTowerStaging();
    if (result.promoted) console.log("Verified tower staging data promoted to Redis DBs 2/3; DB 1 was untouched.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { promoteTowerStaging };
if (require.main === module) main();

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("redis");

const REGION_FILES = [
  {
    region: "bay_area",
    file: path.resolve("data/opencellid/ongoing/bay_area_ca.csv"),
  },
  {
    region: "miami",
    file: path.resolve("data/opencellid/ongoing/miami_fl.csv"),
  },
];

function makeTowerId(fields, region) {
  const mcc = fields[1] || "";
  const mnc = fields[2] || "";
  const lac = fields[3] || "";
  const cell = fields[4] || "";
  const lon = fields[6] || "";
  const lat = fields[7] || "";
  return `tower:${region}:${mcc}:${mnc}:${lac}:${cell}:${lat}:${lon}`;
}

async function loadRegion(client, regionFile) {
  const { region, file } = regionFile;
  if (!fs.existsSync(file)) {
    throw new Error(`Missing source CSV: ${file}`);
  }

  const stream = fs.createReadStream(file);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let count = 0;
  const regionGeoKey = `towers:${region}`;

  for await (const line of rl) {
    lineNo += 1;
    if (!line || !line.trim()) {
      continue;
    }
    if (lineNo === 1) {
      continue;
    }

    const fields = line.split(",");
    if (fields.length < 13) {
      continue;
    }

    const lon = Number.parseFloat(fields[6]);
    const lat = Number.parseFloat(fields[7]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }

    const radio = (fields[0] || "UNKNOWN").toUpperCase();
    const towerId = makeTowerId(fields, region);

    await client.geoAdd(regionGeoKey, {
      longitude: lon,
      latitude: lat,
      member: towerId,
    });

    await client.geoAdd(`towers:${radio.toLowerCase()}`, {
      longitude: lon,
      latitude: lat,
      member: towerId,
    });

    await client.hSet(towerId, {
      id: towerId,
      radio,
      mcc: fields[1] || "",
      mnc: fields[2] || "",
      lac: fields[3] || "",
      cell: fields[4] || "",
      range: fields[5] || "",
      lon: String(lon),
      lat: String(lat),
      samples: fields[8] || "",
      change: fields[9] || "",
      created: fields[11] || "",
      updated: fields[12] || "",
      averageSignal: fields[13] || "",
      region,
    });

    count += 1;
  }

  return count;
}

async function run() {
  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  const client = createClient({ url: redisUrl });

  client.on("error", (err) => {
    console.error("Redis client error:", err);
  });

  await client.connect();

  try {
    console.log(`Connected to Redis at ${redisUrl}`);

    const counts = {};
    let total = 0;

    for (const regionFile of REGION_FILES) {
      const loaded = await loadRegion(client, regionFile);
      counts[regionFile.region] = loaded;
      total += loaded;
      console.log(`Loaded ${loaded.toLocaleString()} towers for ${regionFile.region}`);
    }

    await client.hSet("towers:meta", {
      loadedAt: new Date().toISOString(),
      total: String(total),
      bayArea: String(counts.bay_area || 0),
      miami: String(counts.miami || 0),
    });

    console.log(`Done. Total towers loaded: ${total.toLocaleString()}`);
  } finally {
    await client.quit();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

import path from "node:path";
import dotenv from "dotenv";
import { verifyPendingSaltFingerprint } from "./preserve_redis_salts.mjs";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const stateFile = path.resolve(".n-apt/redis/salt-fingerprint.pending.json");
try {
  const result = await verifyPendingSaltFingerprint({
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379/0",
    stateFile,
  });
  if (result.pending) console.log("Redis authentication check passed; DB 1 capture salts match their pre-setup fingerprints.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

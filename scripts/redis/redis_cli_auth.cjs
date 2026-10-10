const { spawnSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");

function resolveRedisCliConfig(adminUrlText) {
  if (!adminUrlText) throw new Error("REDIS_ADMIN_URL is required for Redis maintenance commands.");
  let url;
  try {
    url = new URL(adminUrlText);
  } catch {
    throw new Error("REDIS_ADMIN_URL must be a valid Redis URL.");
  }
  if ((url.protocol !== "redis:" && url.protocol !== "rediss:") || !url.username || !url.password) {
    throw new Error("REDIS_ADMIN_URL must use redis(s):// and include ACL credentials.");
  }
  return {
    host: decodeURIComponent(url.hostname.replace(/^\[|\]$/g, "")),
    port: url.port || "6379",
    database: url.pathname.replace(/^\//, "") || "0",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    tls: url.protocol === "rediss:",
  };
}

function main(argv = process.argv.slice(2)) {
  dotenv.config({ path: path.resolve(".env.local"), quiet: true });
  dotenv.config({ path: path.resolve(".env"), quiet: true });
  let config;
  try {
    config = resolveRedisCliConfig(process.env.REDIS_ADMIN_URL);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const args = ["--user", config.username, "-h", config.host, "-p", config.port];
  if (config.tls) args.push("--tls");
  args.push("-n", config.database, ...argv);
  const result = spawnSync("redis-cli", args, {
    stdio: "inherit",
    env: { ...process.env, REDISCLI_AUTH: config.password },
  });
  if (result.error) {
    process.stderr.write(`Could not launch redis-cli: ${result.error.message}\n`);
    process.exitCode = 127;
  } else {
    process.exitCode = result.status ?? 1;
  }
}

module.exports = { resolveRedisCliConfig };
if (require.main === module) main();

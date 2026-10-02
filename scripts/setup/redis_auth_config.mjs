import { createHash, randomBytes as cryptoRandomBytes } from "node:crypto";
import dotenv from "dotenv";

const APP_USERNAME = "napt-app";
const OPERATOR_USERNAME = "napt-operator";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0";
const APP_COMMANDS = [
  "del", "eval", "evalsha", "expire", "exists", "geoadd", "get", "hgetall",
  "hello", "info", "mget", "ping", "scan", "select", "set", "setex", "zcard", "zrange",
];

function parseEnv(envText) {
  try {
    return dotenv.parse(envText);
  } catch (error) {
    throw new Error(`Could not parse .env.local: ${error.message}`);
  }
}

function setEnvValue(envText, key, value) {
  const lines = envText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const matchingLines = lines
    .map((line, index) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1] === key ? index : -1)
    .filter((index) => index >= 0);
  if (matchingLines.length > 1) {
    throw new Error(`Duplicate ${key} entries in .env.local; resolve them before configuring Redis authentication.`);
  }
  if (matchingLines.length === 1) {
    const index = matchingLines[0];
    const newline = lines[index].endsWith("\n") ? "\n" : "";
    lines[index] = `${key}=${value}${newline}`;
    return lines.join("");
  }
  const separator = envText.length > 0 && !envText.endsWith("\n") ? "\n" : "";
  return `${envText}${separator}${key}=${value}\n`;
}

function makeAuthenticatedUrl(rawUrl, username, password) {
  const url = new URL(rawUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isUnauthenticatedLocalRedis(envText) {
  const values = parseEnv(envText);
  let url;
  try {
    url = new URL(values.REDIS_URL || DEFAULT_REDIS_URL);
  } catch {
    return false;
  }
  return (url.protocol === "redis:" || url.protocol === "rediss:")
    && isLoopback(url.hostname)
    && (!url.username || !url.password);
}

export function isLocalRedisUrl(envText) {
  const values = parseEnv(envText);
  try {
    const url = new URL(values.REDIS_URL || DEFAULT_REDIS_URL);
    return (url.protocol === "redis:" || url.protocol === "rediss:") && isLoopback(url.hostname);
  } catch {
    return false;
  }
}

function redisUserLine(username, password, permissions) {
  const passwordHash = createHash("sha256").update(password).digest("hex");
  return `user ${username} on #${passwordHash} ${permissions.join(" ")}`;
}

export function renderRedisAcl({ appUsername, appPassword, operatorPassword }) {
  if (!/^[A-Za-z0-9_-]+$/.test(appUsername)) {
    throw new Error("Redis app username must contain only letters, digits, underscores, and hyphens.");
  }
  const appPermissions = ["~session:*", "~challenge:*", "~artifacts:*", "~capture-protection:*", "~tower:*", "~towers:*", "~region:*", "~local:*"];
  appPermissions.push(...APP_COMMANDS.map((command) => `+${command}`));
  return [
    "user default off",
    redisUserLine(appUsername, appPassword, appPermissions),
    redisUserLine(OPERATOR_USERNAME, operatorPassword, ["~*", "&*", "+@all"]),
    "",
  ].join("\n");
}

export function ensureRedisAuthConfig({ envText, randomBytes = cryptoRandomBytes }) {
  const current = parseEnv(envText);
  const appUrlText = current.REDIS_URL || DEFAULT_REDIS_URL;
  let appUrl;
  try {
    appUrl = new URL(appUrlText);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis URL before Redis authentication can be configured.");
  }
  if (appUrl.protocol !== "redis:" && appUrl.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }

  if (!isLoopback(appUrl.hostname) && (!appUrl.username || !appUrl.password)) {
    throw new Error("External Redis URL must already include authentication; configure its ACL and secret externally.");
  }

  const isManagedLocalRedis = isLoopback(appUrl.hostname);
  let appUsername = decodeURIComponent(appUrl.username || "");
  let appPassword = decodeURIComponent(appUrl.password || "");
  if (isManagedLocalRedis && (!appUsername || !appPassword)) {
    if (appPassword) {
      // Redis requirepass authenticates the default user; transfer the same
      // password to the restricted app ACL user during the config cutover.
      appUsername = APP_USERNAME;
      appUrl = new URL(makeAuthenticatedUrl(appUrl.toString(), appUsername, appPassword));
    } else {
      appUsername = APP_USERNAME;
      appPassword = randomBytes(32).toString("hex");
      appUrl = new URL(makeAuthenticatedUrl(appUrl.toString(), appUsername, appPassword));
    }
  } else if (isManagedLocalRedis && appUsername !== APP_USERNAME) {
    // Existing local Redis credentials are preserved; only move the username
    // into the dedicated ACL account that setup will create.
    appUsername = APP_USERNAME;
    appUrl = new URL(makeAuthenticatedUrl(appUrl.toString(), appUsername, appPassword));
  }

  let resultEnv = envText;
  if (isManagedLocalRedis) {
    resultEnv = setEnvValue(resultEnv, "REDIS_URL", appUrl.toString());
  }

  let adminUrlText = current.REDIS_ADMIN_URL;
  let operatorPassword;
  if (isManagedLocalRedis) {
    if (adminUrlText) {
      let adminUrl;
      try {
        adminUrl = new URL(adminUrlText);
      } catch {
        throw new Error("REDIS_ADMIN_URL must be a valid Redis URL.");
      }
      if (!isLoopback(adminUrl.hostname) || !adminUrl.username || !adminUrl.password) {
        throw new Error("Local REDIS_ADMIN_URL must contain local Redis ACL credentials.");
      }
      if (decodeURIComponent(adminUrl.username) !== OPERATOR_USERNAME) {
        throw new Error(`Local REDIS_ADMIN_URL username must be ${OPERATOR_USERNAME}.`);
      }
      operatorPassword = decodeURIComponent(adminUrl.password);
    } else {
      operatorPassword = randomBytes(32).toString("hex");
      adminUrlText = makeAuthenticatedUrl(appUrl.toString(), OPERATOR_USERNAME, operatorPassword);
      resultEnv = setEnvValue(resultEnv, "REDIS_ADMIN_URL", adminUrlText);
    }
  }

  const aclText = isManagedLocalRedis
    ? renderRedisAcl({ appUsername, appPassword, operatorPassword })
    : null;
  return { envText: resultEnv, aclText, managedLocalRedis: isManagedLocalRedis };
}

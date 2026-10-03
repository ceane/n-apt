const { createHash } = require("node:crypto");

const OPERATOR_USERNAME = "napt-operator";
const APP_COMMANDS = [
  "del", "eval", "evalsha", "expire", "exists", "geoadd", "get", "hgetall",
  "hello", "info", "mget", "ping", "quit", "scan", "select", "set", "setex", "zcard", "zrange",
];

function redisUserLine(username, password, permissions) {
  // Redis ACL's `#` credential form requires SHA-256(password); generated local credentials are 32-byte CSPRNG values.
  const passwordHash = createHash("sha256").update(password).digest("hex");
  return `user ${username} on #${passwordHash} ${permissions.join(" ")}`;
}

function renderRedisAcl({ appUsername, appPassword, operatorPassword }) {
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

module.exports = { renderRedisAcl };

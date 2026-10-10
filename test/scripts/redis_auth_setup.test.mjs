import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ensureRedisAuthConfig, isLocalRedisUrl, renderRedisAcl } from "../../scripts/setup/redis_auth_config.mjs";

const require = createRequire(import.meta.url);
const { resolveRedisCliConfig } = require("../../scripts/redis/redis_cli_auth.cjs");
const { renderRedisAcl: renderRedisAclFromCommonJs } = require("../../scripts/setup/redis_acl.cjs");

let deterministicCredential = 0xab;
function deterministicRandomBytes(size) {
  deterministicCredential += 1;
  return Buffer.alloc(size, deterministicCredential);
}

test("new local setup creates stable app and operator credentials and ACLs", () => {
  const first = ensureRedisAuthConfig({
    envText: "NODE_ENV=development\n",
    randomBytes: deterministicRandomBytes,
  });

  assert.match(first.envText, /^REDIS_URL=redis:\/\/napt-app:[a-f0-9]{64}@127\.0\.0\.1:6379\/0$/m);
  assert.match(first.envText, /^REDIS_ADMIN_URL=redis:\/\/napt-operator:[a-f0-9]{64}@127\.0\.0\.1:6379\/0$/m);
  assert.notEqual(new URL(first.envText.match(/^REDIS_URL=(.+)$/m)[1]).password, new URL(first.envText.match(/^REDIS_ADMIN_URL=(.+)$/m)[1]).password);
  assert.match(first.aclText, /^user default off$/m);
  assert.match(first.aclText, /^user napt-app on #([a-f0-9]{64}) /m);
  assert.match(first.aclText, /^user napt-operator on #([a-f0-9]{64}) /m);
  assert.match(first.aclText, /\+quit(?: |$)/m, "app client must be able to close Redis connections");
  assert.doesNotMatch(first.aclText, /ab{63}/i);

  const second = ensureRedisAuthConfig({ envText: first.envText, randomBytes: deterministicRandomBytes });
  assert.equal(second.envText, first.envText);
  assert.equal(second.aclText, first.aclText);
});

test("the CommonJS integration helper shares the production Redis ACL renderer", () => {
  const options = {
    appUsername: "napt-app",
    appPassword: "app-secret",
    operatorPassword: "operator-secret",
  };
  assert.equal(renderRedisAclFromCommonJs(options), renderRedisAcl(options));
});

test("existing local setup preserves unrelated credentials and capture salts", () => {
  const existing = [
    "UNSAFE_LOCAL_USER_PASSWORD=keep-existing-password",
    "NAPT_PBKDF2_SALT=keep-backend-salt",
    "VITE_PBKDF2_SALT=keep-frontend-salt",
    "REDIS_URL=redis://127.0.0.1:6380/0",
    "REDIS_HOST=127.0.0.1",
    "REDIS_PORT=6380",
  ].join("\n") + "\n";

  const first = ensureRedisAuthConfig({ envText: existing, randomBytes: deterministicRandomBytes });
  const second = ensureRedisAuthConfig({ envText: first.envText, randomBytes: () => { throw new Error("credentials rotated"); } });

  for (const preserved of [
    "UNSAFE_LOCAL_USER_PASSWORD=keep-existing-password",
    "NAPT_PBKDF2_SALT=keep-backend-salt",
    "VITE_PBKDF2_SALT=keep-frontend-salt",
  ]) assert.ok(first.envText.includes(preserved));
  assert.match(first.envText, /@127\.0\.0\.1:6380\/0$/m);
  assert.equal(second.envText, first.envText);
  assert.equal(second.aclText, first.aclText);
});

test("setup refuses an unauthenticated external Redis URL without changing it", () => {
  const envText = "REDIS_URL=redis:\/\/redis.example.test:6379/0\n";
  assert.throws(
    () => ensureRedisAuthConfig({ envText, randomBytes: deterministicRandomBytes }),
    /external Redis URL must already include authentication/i,
  );
});

test("local setup preserves an existing Redis password while moving it to the app ACL user", () => {
  const configured = ensureRedisAuthConfig({
    envText: "REDIS_URL=redis://:existing-redis-secret@127.0.0.1:6379/1\n",
    randomBytes: deterministicRandomBytes,
  });
  assert.match(configured.envText, /^REDIS_URL=redis:\/\/napt-app:existing-redis-secret@127\.0\.0\.1:6379\/1$/m);
  assert.match(configured.aclText, /^user napt-app on #[a-f0-9]{64} /m);
});

test("local setup rejects an admin URL that does not authenticate as the operator", () => {
  assert.throws(() => ensureRedisAuthConfig({
    envText: [
      "REDIS_URL=redis://napt-app:app-secret@127.0.0.1:6379/0",
      "REDIS_ADMIN_URL=redis://napt-app:admin-secret@127.0.0.1:6379/0",
    ].join("\n"),
    randomBytes: deterministicRandomBytes,
  }), /REDIS_ADMIN_URL username must be napt-operator/i);
});

test("authenticated external Redis remains externally managed", () => {
  const envText = "REDIS_URL=rediss://napt-app:secret@redis.example.test:6380/0\n";
  const configured = ensureRedisAuthConfig({ envText, randomBytes: deterministicRandomBytes });
  assert.equal(configured.envText, envText);
  assert.equal(configured.aclText, null);
  assert.equal(configured.managedLocalRedis, false);
});

test("local Redis detection includes already authenticated local URLs", () => {
  assert.equal(isLocalRedisUrl("REDIS_URL=redis://napt-app:secret@127.0.0.1:6379/0\n"), true);
  assert.equal(isLocalRedisUrl("REDIS_URL=rediss://user:secret@redis.example.test:6380/0\n"), false);
});

test("operator CLI reads credentials and database from the URL without exposing them as args", () => {
  assert.deepEqual(resolveRedisCliConfig("rediss://napt-operator:abc123@[::1]:6380/4"), {
    host: "::1",
    port: "6380",
    database: "4",
    username: "napt-operator",
    password: "abc123",
    tls: true,
  });
});

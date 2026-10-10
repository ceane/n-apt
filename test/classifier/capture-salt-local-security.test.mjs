import assert from "node:assert/strict";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function assertOwnerOnly(target, failures) {
  const info = await lstat(target);
  assert.ok(!info.isSymbolicLink(), `${target} must not redirect protection checks through a symlink`);
  const mode = info.mode & 0o777;
  const expected = info.isDirectory() ? 0o700 : 0o600;
  if (mode !== expected) failures.push(`${path.relative(root, target)} has mode ${mode.toString(8)}; expected ${expected.toString(8)}`);
  if (info.isDirectory()) {
    for (const name of await readdir(target)) await assertOwnerOnly(path.join(target, name), failures);
  }
}

test("local vault and Redis persistence files are owner-only", async (t) => {
  const failures = [];
  let checked = 0;
  for (const relative of [".env.local", ".redis_data", "redis/data", "redis/backups"]) {
    try {
      await lstat(path.join(root, relative));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    checked += 1;
    await assertOwnerOnly(path.join(root, relative), failures);
  }
  if (checked === 0) t.skip("No local vault or Redis persistence paths are present in this checkout");
  assert.deepEqual(failures, [], failures.join("\n"));
});

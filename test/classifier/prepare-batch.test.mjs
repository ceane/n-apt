import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareCapturePackageBatch } from "../../scripts/classifier/prepare-batch.mjs";

test("prepares every package in a directory sequentially into separate output folders", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napt-prepare-batch-"));
  try {
    const packages = path.join(root, "packages");
    await mkdir(path.join(packages, "session-a"), { recursive: true });
    await mkdir(path.join(packages, "session-b"), { recursive: true });
    await writeFile(path.join(packages, "session-a", "datapackage.json"), "{}");
    await writeFile(path.join(packages, "session-b", "capture.zip"), "zip");
    await writeFile(path.join(packages, "ignored.txt"), "not a package");

    const calls = [];
    const result = await prepareCapturePackageBatch({
      packagesPath: packages,
      outputPath: path.join(root, "prepared"),
      split: "train",
      runPackage: async (packagePath, outputPath, split) => {
        calls.push({ packagePath, outputPath, split });
      },
    });

    assert.equal(result.prepared.length, 2);
    assert.deepEqual(
      calls.map(({ packagePath: value }) => path.basename(value)),
      ["session-a", "capture.zip"],
    );
    assert.deepEqual(
      calls.map(({ outputPath: value }) =>
        path.relative(path.join(root, "prepared"), value),
      ),
      ["session-a", path.join("session-b", "capture")],
    );
    assert.ok(calls.every(({ split }) => split === "train"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports package failures after attempting the full batch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napt-prepare-batch-errors-"));
  try {
    const packages = path.join(root, "packages");
    await mkdir(path.join(packages, "a"), { recursive: true });
    await mkdir(path.join(packages, "b"), { recursive: true });
    await writeFile(path.join(packages, "a", "datapackage.json"), "{}");
    await writeFile(path.join(packages, "b", "datapackage.json"), "{}");
    const attempted = [];
    const result = await prepareCapturePackageBatch({
      packagesPath: packages,
      outputPath: path.join(root, "prepared"),
      split: "train",
      runPackage: async (packagePath) => {
        const name = path.basename(packagePath);
        attempted.push(name);
        if (name === "a") throw new Error("bad recovery wrapper");
      },
    });
    assert.deepEqual(attempted, ["a", "b"]);
    assert.equal(result.prepared.length, 1);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error.message, /bad recovery wrapper/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

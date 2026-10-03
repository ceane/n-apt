import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { inspectCaptureEncryption } from "../../scripts/git/check_encrypted_captures.mjs";

const scriptPath = fileURLToPath(
  new URL("../../scripts/git/check_encrypted_captures.mjs", import.meta.url),
);

function iqCapture(encrypted) {
  const metadata = Buffer.from(
    JSON.stringify({ format: "iq", format_version: 3, interleaving: "IQ" }),
  );
  const frames = Buffer.from("[]");
  const payload = Buffer.from([1, 2, 3, 4]);
  const header = Buffer.alloc(40);
  Buffer.from("NAPT-IQ3").copy(header);
  header.writeBigUInt64LE(BigInt(metadata.length), 8);
  header.writeBigUInt64LE(BigInt(frames.length), 16);
  header.writeBigUInt64LE(BigInt(payload.length), 24);
  header[32] = encrypted ? 1 : 0;
  return Buffer.concat([header, metadata, frames, payload]);
}

function legacyNapt(encrypted) {
  const header = Buffer.from(JSON.stringify({ metadata: { encrypted } }));
  const padded = Buffer.alloc(4096, 32);
  header.copy(padded);
  return Buffer.concat([padded, Buffer.alloc(32)]);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "napt-capture-hook-"));
  mkdirSync(join(root, "nested"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "capture-hook-test@example.invalid");
  git(root, "config", "user.name", "Capture Hook Test");
  return root;
}

function runChecker(root, mode, input = "") {
  return spawnSync(process.execPath, [scriptPath, mode], {
    cwd: root,
    input,
    encoding: "utf8",
  });
}

test("recognizes encrypted IQ and legacy NAPT containers and rejects plaintext", () => {
  assert.equal(
    inspectCaptureEncryption("sample.iq", iqCapture(false)).encrypted,
    false,
  );
  assert.equal(
    inspectCaptureEncryption("sample.iq", iqCapture(true)).encrypted,
    true,
  );
  assert.equal(
    inspectCaptureEncryption("sample.napt", legacyNapt(false)).encrypted,
    false,
  );
  assert.equal(
    inspectCaptureEncryption("sample.napt", legacyNapt(true)).encrypted,
    true,
  );
  assert.equal(
    inspectCaptureEncryption("sample.iq", Buffer.from("bad")).encrypted,
    false,
  );
});

test("recognizes NAPTENC1 and NAPTENC2 protected files even with wrapped capture extensions", () => {
  const legacy = Buffer.concat([Buffer.from("NAPTENC1"), Buffer.alloc(60)]);
  const current = Buffer.concat([Buffer.from("NAPTENC2"), Buffer.alloc(28)]);
  assert.equal(inspectCaptureEncryption("sample.iq.enc", legacy).encrypted, true);
  assert.equal(inspectCaptureEncryption("sample.iq.enc.v2.enc", current).encrypted, true);
  assert.equal(inspectCaptureEncryption("sample.iq.enc.v2.enc", current.subarray(0, 30)).encrypted, false);
});

test("staged hook check blocks plaintext and allows encrypted captures", () => {
  const root = makeRepo();
  try {
    const path = join(root, "nested", "sample.iq");
    writeFileSync(path, iqCapture(false));
    git(root, "add", "nested/sample.iq");
    const blocked = runChecker(root, "--staged");
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /plaintext|not marked encrypted/i);

    writeFileSync(path, iqCapture(true));
    git(root, "add", "nested/sample.iq");
    const allowed = runChecker(root, "--staged");
    assert.equal(allowed.status, 0, allowed.stderr);

    const wrappedPath = join(root, "nested", "sample.iq.enc.v2.enc");
    writeFileSync(wrappedPath, Buffer.concat([Buffer.from("NAPTENC2"), Buffer.alloc(28)]));
    git(root, "add", "nested/sample.iq.enc.v2.enc");
    const wrappedAllowed = runChecker(root, "--staged");
    assert.equal(wrappedAllowed.status, 0, wrappedAllowed.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-push scans new history even when a plaintext capture was later deleted", () => {
  const root = makeRepo();
  try {
    const path = join(root, "sample.napt");
    writeFileSync(path, legacyNapt(true));
    git(root, "add", "sample.napt");
    git(root, "commit", "--quiet", "-m", "baseline encrypted capture");

    writeFileSync(path, iqCapture(false));
    git(root, "add", "sample.napt");
    git(root, "commit", "--quiet", "-m", "add plaintext capture");
    unlinkSync(path);
    git(root, "add", "-u");
    git(root, "commit", "--quiet", "-m", "remove plaintext capture");

    const head = git(root, "rev-parse", "HEAD");
    const zero = "0".repeat(40);
    const input = `refs/heads/main ${head} refs/heads/main ${zero}\n`;
    const result = runChecker(root, "--pre-push", input);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sample\.napt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

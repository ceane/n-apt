import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCaptureDirectory } from "../../scripts/migrate_evidentiary_captures.mjs";

function v3Capture() {
  const metadata = Buffer.from(
    JSON.stringify({ format: "iq", format_version: 3, interleaving: "IQ" }),
  );
  const frames = Buffer.from("[]");
  const payload = Buffer.from([77, 78, 79, 80]);
  const header = Buffer.alloc(40);
  Buffer.from("NAPT-IQ3").copy(header);
  header.writeBigUInt64LE(BigInt(metadata.length), 8);
  header.writeBigUInt64LE(BigInt(frames.length), 16);
  header.writeBigUInt64LE(BigInt(payload.length), 24);
  return Buffer.concat([header, metadata, frames, payload]);
}

function legacyNapt() {
  const metadata = {
    encrypted: true,
    channels: [{ offset_iq: 0, iq_length: 8 }],
  };
  const json = Buffer.from(JSON.stringify({ metadata }));
  const ciphertext = Buffer.alloc(48, 39);
  return {
    bytes: Buffer.concat([
      json,
      Buffer.alloc(4096 - json.length, 32),
      ciphertext,
    ]),
    ciphertext,
  };
}

test("migrates directory captures to encrypted V5 in place", () => {
  const directory = mkdtempSync(join(tmpdir(), "napt-evidentiary-migrate-"));
  try {
    const originalPath = join(directory, "manual.iq");
    writeFileSync(originalPath, v3Capture());
    const legacy = legacyNapt();
    writeFileSync(join(directory, "old.napt"), legacy.bytes);
    const key = Buffer.alloc(32, 23);
    const report = migrateCaptureDirectory(directory, key);
    const migrated = readFileSync(originalPath);
    const metadataLength = Number(migrated.readBigUInt64LE(8));
    const metadata = JSON.parse(migrated.subarray(40, 40 + metadataLength));

    assert.equal(report.migrated, 2);
    assert.equal(metadata.format_version, 5);
    assert.equal(metadata.encrypted, true);
    assert.equal(migrated[32], 1);
    assert.deepEqual(readdirSync(directory).sort(), ["manual.iq", "old.napt"]);
    const migratedLegacy = readFileSync(join(directory, "old.napt"));
    const header = JSON.parse(
      migratedLegacy.subarray(0, 4096).toString("utf8").trimEnd(),
    );
    const binary = header.metadata.sections.binary;
    assert.equal(header.metadata.format_version, 5);
    assert.deepEqual(
      migratedLegacy.subarray(
        binary.offset_bytes,
        binary.offset_bytes + binary.length_bytes,
      ),
      legacy.ciphertext,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps every original intact if any capture cannot be converted", () => {
  const directory = mkdtempSync(join(tmpdir(), "napt-evidentiary-abort-"));
  try {
    const originalPath = join(directory, "manual.iq");
    const original = v3Capture();
    writeFileSync(originalPath, original);
    writeFileSync(join(directory, "broken.napt"), Buffer.from("not a capture"));

    assert.throws(
      () => migrateCaptureDirectory(directory, Buffer.alloc(32, 23)),
      /capture|header|encrypted/i,
    );
    assert.deepEqual(readFileSync(originalPath), original);
    assert.deepEqual(readdirSync(directory).sort(), [
      "broken.napt",
      "manual.iq",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dry run validates all inputs without replacing any original", () => {
  const directory = mkdtempSync(join(tmpdir(), "napt-evidentiary-dry-run-"));
  try {
    const originalPath = join(directory, "manual.iq");
    const original = v3Capture();
    writeFileSync(originalPath, original);
    const report = migrateCaptureDirectory(directory, Buffer.alloc(32, 23), {
      dryRun: true,
    });

    assert.equal(report.migrated, 1);
    assert.deepEqual(readFileSync(originalPath), original);
    assert.deepEqual(readdirSync(directory), ["manual.iq"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

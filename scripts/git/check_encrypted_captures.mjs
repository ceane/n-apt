#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IQ_MAGIC = Buffer.from("NAPT-IQ3");
const LEGACY_ENVELOPE_MAGIC = Buffer.from("NAPTENC1");
const ENVELOPE_MAGIC = Buffer.from("NAPTENC2");
const CAPTURE_EXTENSIONS = new Set([".iq", ".napt"]);
const MAX_HEADER_BYTES = 1024 * 1024;

function isCapturePath(path) {
  const lower = path.toLowerCase();
  return CAPTURE_EXTENSIONS.has(extname(lower)) || /\.(iq|napt)(?:\.enc)?(?:\.v\d+\.enc)?$/.test(lower);
}

function readU64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) return null;
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function parseHeaderObject(bytes) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  const limit = Math.min(bytes.length, MAX_HEADER_BYTES);
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) {
      inString = true;
    } else if (byte === 0x7b) {
      if (start < 0) start = index;
      depth += 1;
    } else if (byte === 0x7d) {
      depth -= 1;
      if (start >= 0 && depth === 0) {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(start, index + 1),
          ),
        );
      }
    }
  }
  throw new Error("No complete JSON metadata object found in capture header");
}

function getMetadata(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const metadata = root.metadata ?? root;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  return metadata;
}

function inspectIq(bytes) {
  if (bytes.length < 40)
    return { encrypted: false, reason: "truncated NAPT-IQ3 header" };
  const metadataLength = readU64(bytes, 8);
  const framesLength = readU64(bytes, 16);
  const payloadLength = readU64(bytes, 24);
  if (
    metadataLength === null ||
    framesLength === null ||
    payloadLength === null
  ) {
    return { encrypted: false, reason: "invalid NAPT-IQ3 lengths" };
  }
  const metadataEnd = 40 + metadataLength;
  const framesEnd = metadataEnd + framesLength;
  const payloadEnd = framesEnd + payloadLength;
  if (!Number.isSafeInteger(payloadEnd) || payloadEnd > bytes.length) {
    return { encrypted: false, reason: "truncated NAPT-IQ3 sections" };
  }
  let metadata;
  try {
    metadata = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(40, metadataEnd),
      ),
    );
  } catch {
    return { encrypted: false, reason: "invalid NAPT-IQ3 metadata JSON" };
  }
  if (metadata?.format !== "iq")
    return { encrypted: false, reason: "missing IQ format metadata" };
  if (bytes[32] !== 1)
    return { encrypted: false, reason: "NAPT-IQ3 payload flag is plaintext" };
  const version = metadata.format_version ?? 3;
  if (!Number.isInteger(version) || version < 3 || version > 6) {
    return {
      encrypted: false,
      reason: `unsupported IQ version ${String(version)}`,
    };
  }
  if (version >= 4 && metadata.sections?.binary?.encrypted !== true) {
    return {
      encrypted: false,
      reason: "IQ section index does not mark its payload encrypted",
    };
  }
  return { encrypted: true, format: "iq", version };
}

/** Returns the encryption marker status for .iq and .napt capture file bytes. */
export function inspectCaptureEncryption(filePath, input) {
  const bytes = Buffer.from(input);
  if (bytes.subarray(0, 8).equals(LEGACY_ENVELOPE_MAGIC)) {
    return bytes.length >= 68
      ? { encrypted: true, format: "capture-envelope-v1" }
      : { encrypted: false, reason: "truncated NAPTENC1 envelope" };
  }
  if (bytes.subarray(0, 8).equals(ENVELOPE_MAGIC)) {
    return bytes.length >= 36
      ? { encrypted: true, format: "capture-envelope-v2" }
      : { encrypted: false, reason: "truncated NAPTENC2 envelope" };
  }
  if (!isCapturePath(filePath))
    return { encrypted: true, reason: "not an I/Q capture path" };
  if (bytes.subarray(0, 8).equals(IQ_MAGIC)) return inspectIq(bytes);
  try {
    const metadata = getMetadata(parseHeaderObject(bytes));
    if (!metadata)
      return { encrypted: false, reason: "capture metadata is missing" };
    const marked =
      metadata.encrypted === true ||
      metadata.encrypted === "true" ||
      metadata.sections?.binary?.encrypted === true;
    if (marked)
      return {
        encrypted: true,
        format: metadata.format ?? "legacy-napt",
        version: metadata.format_version ?? null,
      };
    return {
      encrypted: false,
      reason: "NAPT metadata does not mark the binary payload encrypted",
    };
  } catch (error) {
    return { encrypted: false, reason: error.message };
  }
}

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: options.encoding ?? null,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitText(cwd, args) {
  return git(cwd, args, { encoding: "utf8" }).toString();
}

function blobAtIndex(cwd, path) {
  const oid = gitText(cwd, ["rev-parse", "--verify", `:${path}`]).trim();
  return blobByOid(cwd, oid);
}

function blobByOid(cwd, oid) {
  const size = Number(gitText(cwd, ["cat-file", "-s", oid]));
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error(`Invalid Git object size for ${oid}`);
  return git(cwd, ["cat-file", "blob", oid], {
    maxBuffer: Math.max(size + 1, 1024),
  });
}

function blobAtTree(cwd, treeish, path) {
  const records = git(cwd, [
    "ls-tree",
    "-z",
    treeish,
    "--",
    `:(literal)${path}`,
  ]);
  const first = records.toString("utf8").split("\0", 1)[0];
  if (!first) return null;
  const tab = first.indexOf("\t");
  if (tab < 0) throw new Error(`Invalid Git tree entry for ${path}`);
  const [mode, type, oid] = first.slice(0, tab).split(" ");
  if (
    type !== "blob" ||
    (mode !== "100644" && mode !== "100755" && mode !== "120000")
  ) {
    throw new Error(`Capture path ${path} is not a regular Git blob`);
  }
  return blobByOid(cwd, oid);
}

function checkCapture(cwd, path, bytes, location, failures) {
  const status = inspectCaptureEncryption(path, bytes);
  if (!status.encrypted)
    failures.push(`${path} (${location}): ${status.reason}`);
}

function stagedPaths(cwd) {
  const output = git(cwd, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMRT",
    "-z",
  ]);
  return output.toString("utf8").split("\0").filter(Boolean);
}

function checkStaged(cwd) {
  const failures = [];
  let checked = 0;
  for (const path of stagedPaths(cwd)) {
    if (!isCapturePath(path)) continue;
    checked += 1;
    checkCapture(cwd, path, blobAtIndex(cwd, path), "staged", failures);
  }
  return { checked, failures };
}

function changedPathEntries(cwd, commit) {
  const output = git(cwd, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--no-renames",
    "--name-status",
    "--diff-filter=ACDMRT",
    "-r",
    "-z",
    commit,
  ]);
  const fields = output.toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      entries.push({ status, path: oldPath, deleted: true });
      entries.push({ status, path: newPath, deleted: false });
    } else {
      entries.push({
        status,
        path: fields[index++],
        deleted: status.startsWith("D"),
      });
    }
  }
  return entries;
}

function newCommits(cwd, localSha, remoteSha) {
  const args = ["rev-list", localSha];
  if (!/^0+$/.test(remoteSha)) args.push(`^${remoteSha}`);
  return gitText(cwd, args).split(/\r?\n/).filter(Boolean);
}

function checkPushedHistory(cwd, input) {
  const failures = [];
  const seen = new Set();
  let checked = 0;
  const zero = "0".repeat(40);
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    const localSha = fields[1];
    const remoteSha = fields[3];
    if (!localSha || /^0+$/.test(localSha)) continue;
    if (!remoteSha) throw new Error(`Invalid pre-push ref line: ${line}`);
    const commits = newCommits(cwd, localSha, remoteSha || zero);
    for (const commit of commits) {
      let parent = null;
      try {
        parent =
          gitText(cwd, ["rev-parse", "--verify", `${commit}^`]).trim() || null;
      } catch {
        // The first commit in an unpushed history has no parent.
      }
      for (const entry of changedPathEntries(cwd, commit)) {
        if (!isCapturePath(entry.path)) continue;
        const key = `${commit}:${entry.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const treeish = entry.deleted ? parent : commit;
        if (!treeish) continue;
        const bytes = blobAtTree(cwd, treeish, entry.path);
        if (!bytes) continue;
        checked += 1;
        checkCapture(
          cwd,
          entry.path,
          bytes,
          `commit ${commit.slice(0, 12)}`,
          failures,
        );
      }
    }
  }
  return { checked, failures };
}

function report(mode, result) {
  if (result.failures.length) {
    process.stderr.write(`I/Q capture encryption check blocked ${mode}:\n`);
    for (const failure of result.failures)
      process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
      "Encrypt captures before committing or pushing them.\n",
    );
    return 1;
  }
  if (result.checked) {
    process.stdout.write(
      `I/Q capture encryption check passed (${result.checked} capture blob(s)).\n`,
    );
  }
  return 0;
}

function main(args = process.argv.slice(2)) {
  const cwd = resolve(
    gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim(),
  );
  if (args[0] === "--staged" && args.length === 1) {
    return report("commit", checkStaged(cwd));
  }
  if (args[0] === "--pre-push" && args.length === 1) {
    return report("push", checkPushedHistory(cwd, readFileSync(0, "utf8")));
  }
  process.stderr.write(
    "Usage: node scripts/git/check_encrypted_captures.mjs --staged|--pre-push\n",
  );
  return 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`check_encrypted_captures: ${error.message}\n`);
    process.exitCode = 2;
  }
}

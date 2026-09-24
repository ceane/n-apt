import { createHash } from "node:crypto";
import { verifyStampedIntegrity } from "@n-apt/webusb/iqIntegrity";

export type ExpectedCaptureArtifact = {
  filename: string;
  fileSize: number;
  checksum: string;
};

export type VerifiedCaptureArtifact = {
  format: "iq" | "napt" | "wav";
  formatVersion: number;
  frameUpdateCount: number;
  checksum: string;
};

type CaptureMetadata = Record<string, unknown> & {
  format?: string;
  format_version?: number;
  frame_updates?: Array<{
    sample_offset?: number;
    patch?: Record<string, unknown>;
  }>;
  sections?: {
    trailer?: {
      offset_bytes?: number;
      length_bytes?: number;
    };
  };
};

const decoder = new TextDecoder();

function readU64(bytes: Uint8Array, offset: number): number {
  const value = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Capture artifact contains an unsafe size field");
  }
  return Number(value);
}

function parseJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    return JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Capture artifact has invalid ${label}: ${String(error)}`);
  }
}

function parseIqArtifact(bytes: Uint8Array): {
  metadata: CaptureMetadata;
  frameUpdates: CaptureMetadata["frame_updates"];
} {
  if (
    bytes.byteLength < 40 ||
    decoder.decode(bytes.subarray(0, 8)) !== "NAPT-IQ3"
  ) {
    throw new Error("Downloaded IQ artifact has an invalid NAPT-IQ3 header");
  }
  const metadataLength = readU64(bytes, 8);
  const frameLength = readU64(bytes, 16);
  const payloadLength = readU64(bytes, 24);
  const metadataStart = 40;
  const frameStart = metadataStart + metadataLength;
  const payloadStart = frameStart + frameLength;
  if (payloadStart + payloadLength > bytes.byteLength) {
    throw new Error("Downloaded IQ artifact is truncated");
  }
  return {
    metadata: parseJson(
      bytes.subarray(metadataStart, frameStart),
      "IQ metadata",
    ) as CaptureMetadata,
    frameUpdates: parseJson(
      bytes.subarray(frameStart, payloadStart),
      "IQ frame updates",
    ) as unknown as CaptureMetadata["frame_updates"],
  };
}

function parseNaptArtifact(bytes: Uint8Array): {
  metadata: CaptureMetadata;
  frameUpdates: CaptureMetadata["frame_updates"];
} {
  const headerEnd = bytes
    .subarray(0, Math.min(bytes.byteLength, 65_536))
    .indexOf(10);
  if (headerEnd <= 0) {
    throw new Error("Downloaded NAPT artifact has an invalid header boundary");
  }
  const root = parseJson(bytes.subarray(0, headerEnd), "NAPT header");
  const metadata = (root.metadata ?? root) as CaptureMetadata;
  return { metadata, frameUpdates: metadata.frame_updates };
}

async function verifyEmbeddedIntegrity(
  bytes: Uint8Array,
  metadata: CaptureMetadata,
): Promise<void> {
  const section = metadata.sections?.trailer;
  const offset = section?.offset_bytes;
  const length = section?.length_bytes;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    (offset as number) < 0 ||
    (length as number) < 24 ||
    (offset as number) + (length as number) > bytes.byteLength
  ) {
    throw new Error(
      "Capture artifact has an invalid integrity trailer section",
    );
  }
  const trailer = bytes.subarray(
    offset as number,
    (offset as number) + (length as number),
  );
  if (
    decoder.decode(trailer.subarray(0, 8)) !== "NAPTTRLR" ||
    trailer[8] !== 2
  ) {
    throw new Error("Capture artifact is missing the V2 integrity trailer");
  }
  const jsonLength = readU64(trailer, 16);
  if (jsonLength + 24 !== trailer.byteLength) {
    throw new Error("Capture artifact has an invalid integrity trailer length");
  }
  const parsed = parseJson(trailer.subarray(24), "integrity trailer");
  const integrity = parsed.integrity as
    | {
        algorithm?: string;
        scope?: string;
        digest?: string;
      }
    | undefined;
  if (
    integrity?.algorithm !== "SHA-256" ||
    integrity.scope !== "file-with-integrity-digest-placeholder" ||
    !integrity.digest
  ) {
    throw new Error("Capture artifact integrity metadata is incomplete");
  }
  if (!(await verifyStampedIntegrity(bytes, integrity.digest))) {
    throw new Error("Capture artifact integrity verification failed");
  }
}

function verifyFrameUpdates(
  frameUpdates: CaptureMetadata["frame_updates"],
): number {
  if (!Array.isArray(frameUpdates) || frameUpdates.length === 0) {
    throw new Error("Capture artifact has no frame update or patch history");
  }
  if (frameUpdates[0]?.sample_offset !== 0) {
    throw new Error(
      "Capture artifact does not begin with a byte-zero frame update",
    );
  }
  for (const update of frameUpdates) {
    if (
      !Number.isSafeInteger(update?.sample_offset) ||
      (update.sample_offset as number) < 0 ||
      !update.patch ||
      typeof update.patch !== "object"
    ) {
      throw new Error("Capture artifact contains an invalid frame update");
    }
  }
  return frameUpdates.length;
}

export async function verifyCaptureArtifact(
  bytes: Uint8Array,
  expected: ExpectedCaptureArtifact,
): Promise<VerifiedCaptureArtifact> {
  if (
    !Number.isSafeInteger(expected.fileSize) ||
    expected.fileSize !== bytes.byteLength
  ) {
    throw new Error("Capture artifact size does not match the completed job");
  }
  if (!/^[0-9a-f]{64}$/i.test(expected.checksum)) {
    throw new Error("Capture artifact checksum is missing or invalid");
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== expected.checksum.toLowerCase()) {
    throw new Error(
      "Capture artifact checksum does not match the completed job",
    );
  }

  const extension = expected.filename.toLowerCase().split(".").pop();
  if (extension === "iq") {
    const { metadata, frameUpdates } = parseIqArtifact(bytes);
    if (metadata.format !== "iq" || metadata.format_version !== 6) {
      throw new Error("Downloaded IQ artifact is not V6");
    }
    await verifyEmbeddedIntegrity(bytes, metadata);
    return {
      format: "iq",
      formatVersion: 6,
      frameUpdateCount: verifyFrameUpdates(frameUpdates),
      checksum,
    };
  }
  if (extension === "napt") {
    const { metadata, frameUpdates } = parseNaptArtifact(bytes);
    if (metadata.format !== "napt" || metadata.format_version !== 6) {
      throw new Error("Downloaded NAPT artifact is not V6");
    }
    await verifyEmbeddedIntegrity(bytes, metadata);
    return {
      format: "napt",
      formatVersion: 6,
      frameUpdateCount: verifyFrameUpdates(frameUpdates),
      checksum,
    };
  }
  if (extension === "wav") {
    if (
      decoder.decode(bytes.subarray(0, 4)) !== "RIFF" ||
      decoder.decode(bytes.subarray(8, 12)) !== "WAVE"
    ) {
      throw new Error(
        "Downloaded WAV artifact has an invalid RIFF/WAVE header",
      );
    }
    return { format: "wav", formatVersion: 3, frameUpdateCount: 0, checksum };
  }
  throw new Error(
    `Unsupported capture artifact extension: ${extension ?? "none"}`,
  );
}

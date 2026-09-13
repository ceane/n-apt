import type { IqFrameStatus } from "@n-apt/consts/schemas/websocket";

const V1_HEADER_BYTES = 24;
const V2_FIXED_HEADER_BYTES = 56;
const V2_MAGIC = [0x4e, 0x41, 0x50, 0x54] as const;

/** Metadata carried outside the encrypted I/Q sample payload. */
export type IqFrameEnvelopeMetadata = {
  protocol_version: 1 | 2;
  source_id: string;
  stream_epoch?: number;
  sequence?: number;
  timestamp: number;
  center_frequency_hz: number;
  data_type: number;
  sample_rate: number;
  flags?: number;
  frame_status?: IqFrameStatus;
};

/** A validated wire envelope whose payload is still encrypted. */
export type DecodedIqFrameEnvelope = {
  metadata: IqFrameEnvelopeMetadata;
  encryptedPayload: Uint8Array;
};

const isV2Envelope = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && V2_MAGIC.every((value, index) => bytes[index] === value);

const readSafeU64 = (view: DataView, offset: number, field: string): number => {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid I/Q frame ${field}: exceeds JavaScript precision`);
  }
  return Number(value);
};

const validateIqMetadata = (dataType: number, sampleRate: number): void => {
  if (dataType !== 1) {
    throw new Error(`Invalid I/Q frame data type: ${dataType}`);
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid I/Q frame sample rate: ${sampleRate}`);
  }
};

const FRAME_STATUS_BY_WIRE: readonly IqFrameStatus[] = [
  "receiving",
  "standby",
  "transmitting",
  "paused",
];

const decodeFrameStatus = (value: number): IqFrameStatus => {
  const status = FRAME_STATUS_BY_WIRE[value];
  if (!status) {
    throw new Error(`Invalid I/Q frame status: ${value}`);
  }
  return status;
};

/**
 * Decode and validate either the legacy 24-byte envelope or the negotiated v2
 * source-scoped envelope. The returned payload is a zero-copy view.
 */
export const decodeIqFrameEnvelope = (
  buffer: ArrayBuffer,
  fallbackSourceId: string,
): DecodedIqFrameEnvelope => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < V1_HEADER_BYTES) {
    throw new Error("Invalid I/Q frame: shorter than the v1 header");
  }
  const view = new DataView(buffer);

  if (!isV2Envelope(bytes)) {
    const encryptedPayload = new Uint8Array(buffer, V1_HEADER_BYTES);
    if (encryptedPayload.length === 0) {
      throw new Error("Invalid I/Q frame: empty encrypted payload");
    }
    const dataType = view.getUint32(16, true);
    const sampleRate = view.getUint32(20, true);
    validateIqMetadata(dataType, sampleRate);
    return {
      metadata: {
        protocol_version: 1,
        source_id: fallbackSourceId,
        timestamp: readSafeU64(view, 0, "timestamp"),
        center_frequency_hz: readSafeU64(view, 8, "center frequency"),
        data_type: dataType,
        sample_rate: sampleRate,
        frame_status: "receiving",
      },
      encryptedPayload,
    };
  }

  if (bytes.length < V2_FIXED_HEADER_BYTES) {
    throw new Error("Invalid I/Q frame: truncated v2 header");
  }
  const version = view.getUint8(4);
  const flags = view.getUint8(5);
  const frameStatus = view.getUint8(10);
  const headerLength = view.getUint16(6, true);
  const sourceIdLength = view.getUint16(8, true);
  if (version !== 2) {
    throw new Error(`Invalid I/Q frame version: ${version}`);
  }
  if (
    headerLength < V2_FIXED_HEADER_BYTES ||
    headerLength !== V2_FIXED_HEADER_BYTES + sourceIdLength ||
    headerLength >= bytes.length
  ) {
    throw new Error("Invalid I/Q frame header length");
  }

  const sourceId = new TextDecoder("utf-8", { fatal: true })
    .decode(new Uint8Array(buffer, V2_FIXED_HEADER_BYTES, sourceIdLength))
    .trim();
  if (!sourceId) {
    throw new Error("Invalid I/Q frame header: empty source ID");
  }
  const dataType = view.getUint32(48, true);
  const sampleRate = view.getUint32(52, true);
  validateIqMetadata(dataType, sampleRate);
  const encryptedPayload = new Uint8Array(buffer, headerLength);
  if (encryptedPayload.length === 0) {
    throw new Error("Invalid I/Q frame: empty encrypted payload");
  }

  return {
    metadata: {
      protocol_version: 2,
      source_id: sourceId,
      stream_epoch: readSafeU64(view, 16, "stream epoch"),
      sequence: readSafeU64(view, 24, "sequence"),
      timestamp: readSafeU64(view, 32, "timestamp"),
      center_frequency_hz: readSafeU64(view, 40, "center frequency"),
      data_type: dataType,
      sample_rate: sampleRate,
      flags,
      frame_status: decodeFrameStatus(frameStatus),
    },
    encryptedPayload,
  };
};

/** Additive capability value advertised by source metadata. */
export const PREFERRED_IQ_STREAM_PROTOCOL = 2 as const;

export interface IqCaptureChunk {
  sample_offset: number;
  channel: number;
  data: Uint8Array;
}

export interface IqCaptureFrameUpdate {
  sample_offset: number;
  timestamp_us: number;
  patch: Record<string, unknown>;
}

export interface NaptCaptureChannel {
  center_freq_hz: number;
  sample_rate_hz: number;
  requested_min_freq_hz?: number | null;
  requested_max_freq_hz?: number | null;
  bins_per_frame: number;
  label?: string | null;
  /** Byte length of this channel's contiguous IQ region in the NAPT payload. */
  iq_length?: number;
}

export type CaptureMetadata = Record<string, unknown>;

const IQ_MAGIC = new TextEncoder().encode("NAPT-IQ3");
const IQ_HEADER_SIZE = 40;
const TRAILER_MAGIC = new TextEncoder().encode("NAPTTRLR");
const TRAILER_HEADER_SIZE = 24;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT = new TextEncoder().encode("n-apt-aes-salt-v1");
type CaptureBytes = Uint8Array<ArrayBuffer>;

const copyBytes = (bytes: Uint8Array): CaptureBytes => {
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);
  return result;
};

const concatBytes = (...parts: Uint8Array[]): CaptureBytes => {
  const total = parts.reduce((length, part) => length + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const utf8 = (value: string): CaptureBytes =>
  copyBytes(new TextEncoder().encode(value));

const writeU32 = (value: number): CaptureBytes => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const writeU64 = (value: number): CaptureBytes => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
};

const readU64 = (bytes: Uint8Array, offset: number): number => {
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(
    0,
    true,
  );
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Capture size exceeds JavaScript precision");
  }
  return Number(value);
};

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const createIqMetadata = (metadata: CaptureMetadata): CaptureMetadata => ({
  format: "iq",
  format_version: 4,
  interleaving: "IQ",
  sample_encoding: {
    element_type: "integer",
    bits_per_element: 8,
    signed: false,
    byte_order: "little",
    normalization: "(value - 128) / 127",
  },
  ...metadata,
});

const encodeIqPayload = (
  chunks: IqCaptureChunk[],
  privateMetadata?: Record<string, unknown>,
): Uint8Array => {
  const parts: Uint8Array[] = [];
  if (privateMetadata) {
    const bytes = utf8(JSON.stringify(privateMetadata));
    parts.push(utf8("PMD3"), writeU64(bytes.byteLength), bytes);
  }
  for (const chunk of chunks) {
    parts.push(
      writeU64(chunk.sample_offset),
      writeU32(chunk.channel),
      writeU64(chunk.data.byteLength),
      chunk.data,
    );
  }
  return concatBytes(...parts);
};

export const encodeIqCaptureV4 = ({
  metadata,
  frameUpdates,
  chunks,
  privateMetadata,
}: {
  metadata: CaptureMetadata;
  frameUpdates: IqCaptureFrameUpdate[];
  chunks: IqCaptureChunk[];
  privateMetadata?: Record<string, unknown>;
}): Uint8Array => {
  const metadataObject = createIqMetadata({ ...metadata, encrypted: false });
  const framesBytes = utf8(JSON.stringify(frameUpdates));
  const payload = encodeIqPayload(chunks, privateMetadata);
  let binaryOffset = 0;
  let trailerOffset = 0;
  let metadataBytes = new Uint8Array(0);
  const trailerBytes = utf8("{}");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    metadataObject.sections = {
      binary: {
        offset_bytes: binaryOffset,
        length_bytes: payload.byteLength,
        encoding: "iq_u8_interleaved",
        encrypted: false,
      },
      trailer: {
        offset_bytes: trailerOffset,
        length_bytes: TRAILER_HEADER_SIZE + trailerBytes.byteLength,
        encoding: "utf8_json",
        version: 1,
      },
    };
    metadataBytes = utf8(JSON.stringify(metadataObject));
    const nextBinaryOffset =
      IQ_HEADER_SIZE + metadataBytes.byteLength + framesBytes.byteLength;
    const nextTrailerOffset = nextBinaryOffset + payload.byteLength;
    if (nextBinaryOffset === binaryOffset && nextTrailerOffset === trailerOffset) {
      break;
    }
    binaryOffset = nextBinaryOffset;
    trailerOffset = nextTrailerOffset;
  }

  const header = concatBytes(
    IQ_MAGIC,
    writeU64(metadataBytes.byteLength),
    writeU64(framesBytes.byteLength),
    writeU64(payload.byteLength),
    Uint8Array.of(0),
    new Uint8Array(7),
    metadataBytes,
    framesBytes,
    payload,
    TRAILER_MAGIC,
    Uint8Array.of(1),
    new Uint8Array(7),
    writeU64(trailerBytes.byteLength),
    trailerBytes,
  );
  return header;
};

export const decodeIqCaptureHeader = (
  bytes: Uint8Array,
): {
  metadata: CaptureMetadata;
  frameUpdates: IqCaptureFrameUpdate[];
  payload: Uint8Array;
} => {
  if (bytes.byteLength < IQ_HEADER_SIZE ||
      !IQ_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("Invalid NAPT-IQ3 header");
  }
  const metadataLength = readU64(bytes, 8);
  const framesLength = readU64(bytes, 16);
  const payloadLength = readU64(bytes, 24);
  const metadataStart = IQ_HEADER_SIZE;
  const framesStart = metadataStart + metadataLength;
  const payloadStart = framesStart + framesLength;
  if (payloadStart + payloadLength > bytes.byteLength) {
    throw new Error("Truncated NAPT-IQ3 capture");
  }
  const metadata = JSON.parse(
    new TextDecoder().decode(bytes.subarray(metadataStart, framesStart)),
  ) as CaptureMetadata;
  const frameUpdates = JSON.parse(
    new TextDecoder().decode(bytes.subarray(framesStart, payloadStart)),
  ) as IqCaptureFrameUpdate[];
  return {
    metadata,
    frameUpdates,
    payload: bytes.subarray(payloadStart, payloadStart + payloadLength),
  };
};

const deriveVaultKey = async (passphrase: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    "raw",
    utf8(passphrase.trim()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
};

const encryptPayload = async (
  key: CryptoKey,
  plaintext: CaptureBytes,
): Promise<CaptureBytes> => {
  const iv = copyBytes(crypto.getRandomValues(new Uint8Array(12)));
  const ciphertext = copyBytes(
    new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
    ),
  );
  return concatBytes(iv, ciphertext);
};

export const encodeNaptCaptureV4 = async ({
  metadata,
  channels,
  data,
  passphrase,
}: {
  metadata: CaptureMetadata;
  channels: NaptCaptureChannel[];
  data: Uint8Array;
  passphrase: string;
}): Promise<Uint8Array> => {
  if (!passphrase.trim()) throw new Error("A passphrase is required for .napt captures.");
  const vaultKey = await deriveVaultKey(passphrase);
  const dekBytes = crypto.getRandomValues(new Uint8Array(32));
  const dekKey = await crypto.subtle.importKey(
    "raw",
    dekBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const encryptedData = await encryptPayload(dekKey, copyBytes(data));
  const wrappedDek = await encryptPayload(vaultKey, copyBytes(dekBytes));
  const channelMetadata = channels.map((channel, index) => ({
    ...channel,
    offset_iq: channels
      .slice(0, index)
      .reduce((offset, previous) => {
        if (previous.iq_length === undefined) {
          throw new Error(
            "Multi-channel .napt captures require an iq_length for every channel.",
          );
        }
        return offset + previous.iq_length;
      }, 0),
    iq_length:
      channel.iq_length ??
      (channels.length === 1
        ? data.byteLength
        : (() => {
            throw new Error(
              "Multi-channel .napt captures require an iq_length for every channel.",
            );
          })()),
  }));
  const indexedDataLength = channelMetadata.reduce(
    (length, channel) => length + channel.iq_length,
    0,
  );
  if (indexedDataLength !== data.byteLength) {
    throw new Error(".napt channel indexes do not cover the IQ payload.");
  }
  const metadataObject: CaptureMetadata = {
    ...metadata,
    format: "napt",
    format_version: 4,
    encrypted: true,
    interleaving: "IQ",
    channels: channelMetadata,
    wrapped_dek: base64(wrappedDek),
  };
  const trailerJson = utf8(
    JSON.stringify({ processing: { operation: "capture" }, tool_version: "0.5.0" }),
  );
  let headerSize = Math.max(
    4096,
    Math.ceil((utf8(JSON.stringify({ metadata: metadataObject })).byteLength + 513) / 1024) * 1024,
  );
  let completeJson = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const trailerOffset = headerSize + encryptedData.byteLength;
    metadataObject.sections = {
      binary: {
        offset_bytes: headerSize,
        length_bytes: encryptedData.byteLength,
        encoding: "iq_u8_interleaved",
        encrypted: true,
      },
      trailer: {
        offset_bytes: trailerOffset,
        length_bytes: TRAILER_HEADER_SIZE + trailerJson.byteLength,
        encoding: "utf8_json",
        version: 1,
      },
    };
    completeJson = JSON.stringify({ metadata: metadataObject });
    const needed = Math.max(
      4096,
      Math.ceil((utf8(completeJson).byteLength + 1) / 1024) * 1024,
    );
    if (needed <= headerSize) break;
    headerSize = needed;
  }
  const headerBytes = utf8(completeJson);
  const padding = new Uint8Array(Math.max(0, headerSize - headerBytes.byteLength - 1));
  padding.fill(0x20);
  return concatBytes(
    headerBytes,
    Uint8Array.of(0x0a),
    padding,
    encryptedData,
    TRAILER_MAGIC,
    Uint8Array.of(1),
    new Uint8Array(7),
    writeU64(trailerJson.byteLength),
    trailerJson,
  );
};

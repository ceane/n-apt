import crypto from "node:crypto";
import { encodeNaptCaptureV4 } from "@n-apt/webusb/iqCaptureFormat";
import { computeHmac, deriveRawKey } from "@n-apt/crypto/webcrypto";
import {
  getIqFrameAtOffset,
  getIqFrameTimestampAtOffset,
} from "@n-apt/capture/hooks/usePlaybackAnimation";
import { stampIntegrity } from "@n-apt/webusb/iqIntegrity";
import { parseNaptMetadata } from "@n-apt/capture/naptHeader";
import "@n-apt/workers/fileWorker";

const password = "compatibility-passphrase";
const iqBytes = Uint8Array.of(
  128,
  127,
  129,
  126,
  130,
  125,
  131,
  124,
  132,
  123,
  133,
  122,
);
const metadata = {
  center_frequency_hz: 1_600_000,
  capture_sample_rate_hz: 3_200_000,
  hardware_sample_rate_hz: 3_200_000,
  timestamp_utc: "2026-09-01T00:00:00.000Z",
  frame_rate: 10,
  fft_size: 2,
  fft_window: "Rectangular",
  duration_s: 0.2,
  acquisition_mode: "interleaved",
  data_format: "iq_u8",
};

const workerResult = async (
  fileData: Uint8Array,
  fileName: string,
  rawKey: ArrayBuffer,
  fidoVaultKey?: ArrayBuffer,
) => {
  const previousHandler = self.onmessage;
  const handler = self.onmessage as unknown as (
    event: MessageEvent,
  ) => Promise<void>;
  const postMessage = jest
    .spyOn(self, "postMessage")
    .mockImplementation(() => {});
  try {
    await handler({
      data: {
        type: "stitchFiles",
        id: "encryption-compatibility",
        data: {
          files: [{ fileData: fileData.slice().buffer, fileName }],
          settings: {},
          fftSize: 2,
          aesKey: rawKey,
          fidoVaultKey,
        },
      },
    } as MessageEvent);
    return postMessage.mock.calls
      .map(([message]) => message as any)
      .find((message) => message.type === "result" || message.type === "error");
  } finally {
    postMessage.mockRestore();
    self.onmessage = previousHandler;
  }
};

const encryptGcm = async (rawKey: Uint8Array, iv: Uint8Array, plaintext: Uint8Array) => {
  const keyBytes = Uint8Array.from(rawKey);
  const ivBytes = Uint8Array.from(iv);
  const plaintextBytes = Uint8Array.from(plaintext);
  const key = await crypto.webcrypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await crypto.webcrypto.subtle.encrypt({ name: "AES-GCM", iv: ivBytes }, key, plaintextBytes),
  );
};

const makeFidoVaultNapt = async (
  vaultKey: Uint8Array,
  captureIqBytes: Uint8Array = iqBytes,
) => {
  const dek = Uint8Array.from({ length: 32 }, (_, index) => index + 31);
  const wrappedDekIv = Uint8Array.from({ length: 12 }, (_, index) => index + 61);
  const payloadIv = Uint8Array.from({ length: 12 }, (_, index) => index + 91);
  const wrappedDek = new Uint8Array(12 + 32 + 16);
  wrappedDek.set(wrappedDekIv);
  wrappedDek.set(await encryptGcm(vaultKey, wrappedDekIv, dek), 12);
  const encryptedPayload = new Uint8Array(12 + captureIqBytes.length + 16);
  encryptedPayload.set(payloadIv);
  encryptedPayload.set(await encryptGcm(dek, payloadIv, captureIqBytes), 12);
  const frameUpdates = Array.from({ length: 600 }, (_, frame_sequence) => ({
    sample_offset: frame_sequence * 4,
    timestamp_us: (frame_sequence + 1) * 1000,
    kind: "Frame",
    frame_sequence,
    patch: {},
  }));
  const captureMetadata: Record<string, any> = {
    ...metadata,
    format: "napt",
    format_version: 6,
    encrypted: true,
    encryption: "AES-256-GCM-FIDO-VAULT-V1",
    wrapped_dek: Buffer.from(wrappedDek).toString("base64"),
    frame_updates: frameUpdates,
    channels: [{
      center_freq_hz: metadata.center_frequency_hz,
      sample_rate_hz: metadata.capture_sample_rate_hz,
      bins_per_frame: metadata.fft_size,
      offset_iq: 0,
      iq_length: captureIqBytes.length,
    }],
  };
  const trailerJson = JSON.stringify({
    processing: { operation: "capture" },
    integrity: {
      algorithm: "SHA-256",
      scope: "file-with-integrity-digest-placeholder",
      digest: "0".repeat(64),
    },
  });
  let headerSize = 4096;
  let headerJson = "";
  for (;;) {
    captureMetadata.sections = {
      binary: {
        offset_bytes: headerSize,
        length_bytes: encryptedPayload.length,
        encoding: "iq_u8_interleaved",
        encrypted: true,
      },
      trailer: {
        offset_bytes: headerSize + encryptedPayload.length,
        length_bytes: 24 + new TextEncoder().encode(trailerJson).length,
        encoding: "utf8_json",
        version: 2,
      },
    };
    headerJson = JSON.stringify({ metadata: captureMetadata });
    const needed = Math.max(4096, Math.ceil((headerJson.length + 1) / 1024) * 1024);
    if (needed <= headerSize) break;
    headerSize = needed;
  }
  const header = new Uint8Array(headerSize);
  header.set(new TextEncoder().encode(`${headerJson}\n`));
  const trailerBytes = new Uint8Array(24 + new TextEncoder().encode(trailerJson).length);
  trailerBytes.set(new TextEncoder().encode("NAPTTRLR"));
  trailerBytes[8] = 2;
  new DataView(trailerBytes.buffer).setBigUint64(
    16,
    BigInt(new TextEncoder().encode(trailerJson).length),
    true,
  );
  trailerBytes.set(new TextEncoder().encode(trailerJson), 24);
  const file = new Uint8Array(headerSize + encryptedPayload.length + trailerBytes.length);
  file.set(header);
  file.set(encryptedPayload, headerSize);
  file.set(trailerBytes, headerSize + encryptedPayload.length);
  return stampIntegrity(file);
};

const makeFidoVaultIq = async (vaultKey: Uint8Array) => {
  const payloadIv = Uint8Array.from({ length: 12 }, (_, index) => index + 41);
  const payload = new Uint8Array(20 + iqBytes.length);
  new DataView(payload.buffer).setBigUint64(0, 0n, true);
  new DataView(payload.buffer).setUint32(8, 0, true);
  new DataView(payload.buffer).setBigUint64(12, BigInt(iqBytes.length), true);
  payload.set(iqBytes, 20);
  const ciphertext = await encryptGcm(vaultKey, payloadIv, payload);
  const encryptedPayload = new Uint8Array(12 + ciphertext.length);
  encryptedPayload.set(payloadIv);
  encryptedPayload.set(ciphertext, 12);
  const frameUpdates = [0, 1, 2].map((frame_sequence) => ({
    sample_offset: frame_sequence * 4,
    timestamp_us: (frame_sequence + 1) * 1000,
    kind: "Frame",
    frame_sequence,
    patch: {},
  }));
  const iqMetadata: Record<string, any> = {
    format: "iq",
    format_version: 6,
    interleaving: "IQ",
    sample_encoding: {
      element_type: "integer",
      bits_per_element: 8,
      signed: false,
      byte_order: "little",
      normalization: "(value - 128) / 127",
    },
    encryption: "AES-256-GCM-FIDO-VAULT-V1",
    encrypted: true,
    center_frequency_hz: metadata.center_frequency_hz,
    capture_sample_rate_hz: metadata.capture_sample_rate_hz,
    fft_size: metadata.fft_size,
    frame_rate: metadata.frame_rate,
  };
  const framesJson = new TextEncoder().encode(JSON.stringify(frameUpdates));
  const trailerJson = JSON.stringify({
    integrity: {
      algorithm: "SHA-256",
      scope: "file-with-integrity-digest-placeholder",
      digest: "0".repeat(64),
    },
  });
  const trailerJsonBytes = new TextEncoder().encode(trailerJson);
  let metadataJson = "";
  let binaryOffset = 0;
  let trailerOffset = 0;
  for (;;) {
    iqMetadata.sections = {
      binary: {
        offset_bytes: binaryOffset,
        length_bytes: encryptedPayload.length,
        encoding: "iq_u8_interleaved",
        encrypted: true,
      },
      trailer: {
        offset_bytes: trailerOffset,
        length_bytes: 24 + trailerJsonBytes.length,
        encoding: "utf8_json",
        version: 2,
      },
    };
    metadataJson = JSON.stringify(iqMetadata);
    const nextBinaryOffset = 40 + new TextEncoder().encode(metadataJson).length + framesJson.length;
    const nextTrailerOffset = nextBinaryOffset + encryptedPayload.length;
    if (binaryOffset === nextBinaryOffset && trailerOffset === nextTrailerOffset) break;
    binaryOffset = nextBinaryOffset;
    trailerOffset = nextTrailerOffset;
  }
  const metadataBytes = new TextEncoder().encode(metadataJson);
  const header = new Uint8Array(40);
  header.set(new TextEncoder().encode("NAPT-IQ3"));
  const headerView = new DataView(header.buffer);
  headerView.setBigUint64(8, BigInt(metadataBytes.length), true);
  headerView.setBigUint64(16, BigInt(framesJson.length), true);
  headerView.setBigUint64(24, BigInt(encryptedPayload.length), true);
  header[32] = 1;
  const trailer = new Uint8Array(24 + trailerJsonBytes.length);
  trailer.set(new TextEncoder().encode("NAPTTRLR"));
  trailer[8] = 2;
  new DataView(trailer.buffer).setBigUint64(16, BigInt(trailerJsonBytes.length), true);
  trailer.set(trailerJsonBytes, 24);
  const file = new Uint8Array(
    header.length + metadataBytes.length + framesJson.length + encryptedPayload.length + trailer.length,
  );
  let offset = 0;
  for (const part of [header, metadataBytes, framesJson, encryptedPayload, trailer]) {
    file.set(part, offset);
    offset += part.length;
  }
  return stampIntegrity(file);
};

const makeLegacyEncryptedNapt = async (rawKey: ArrayBuffer) => {
  const key = await crypto.webcrypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const encrypted = new Uint8Array(
    await crypto.webcrypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      iqBytes,
    ),
  );
  const legacyHeader = {
    format: "napt",
    format_version: 3,
    encrypted: true,
    offset_iq: 0,
    iq_length: iqBytes.byteLength,
    center_frequency_hz: metadata.center_frequency_hz,
    capture_sample_rate_hz: metadata.capture_sample_rate_hz,
  };
  const json = new TextEncoder().encode(JSON.stringify(legacyHeader) + "\n");
  const prefix = new Uint8Array(4096);
  prefix.set(json);
  const payload = new Uint8Array(iv.length + encrypted.length);
  payload.set(iv);
  payload.set(encrypted, iv.length);
  const result = new Uint8Array(prefix.length + payload.length);
  result.set(prefix);
  result.set(payload, prefix.length);
  return result;
};

describe("encryption compatibility through the capture reader", () => {
  it("matches the Rust auth and legacy vault key golden vectors", async () => {
    const password = "cross-language-auth-vector";
    const authHmac = await computeHmac(password, "Zml4ZWQtbG9naW4tbm9uY2U=");
    expect(authHmac).toBe("T8+gz6PFk/iguPJLGLcuFxo9QYBlaY5gS6FqkT+2Eu8=");
    expect(Buffer.from(await deriveRawKey(password))).toEqual(
      Buffer.from([
        4, 86, 103, 243, 81, 136, 80, 195, 240, 249, 53, 42, 123, 46, 223, 145,
        9, 239, 38, 246, 229, 125, 238, 80, 214, 41, 159, 46, 185, 245, 211,
        112,
      ]),
    );
  });

  it("decrypts V6 writer output and legacy V3 NAPT with the unchanged vault key, then plays three frames", async () => {
    const rawKey = await deriveRawKey(password);
    const currentCapture = await encodeNaptCaptureV4({
      metadata,
      channels: [
        {
          center_freq_hz: metadata.center_frequency_hz,
          sample_rate_hz: metadata.capture_sample_rate_hz,
          bins_per_frame: metadata.fft_size,
          iq_length: iqBytes.byteLength,
        },
      ],
      data: iqBytes,
      passphrase: password,
      frameUpdates: [0, 1, 2].map((frame_sequence) => ({
        sample_offset: frame_sequence * 4,
        timestamp_us: (frame_sequence + 1) * 1000,
        kind: "Frame",
        frame_sequence,
        patch: {},
      })),
    });
    const legacyCapture = await makeLegacyEncryptedNapt(rawKey);

    const current = await workerResult(
      currentCapture,
      "current-v6.napt",
      rawKey,
    );
    const legacy = await workerResult(legacyCapture, "legacy-v3.napt", rawKey);

    expect(current?.type).toBe("result");
    expect(current.data.metadataMap[0][1].encrypted).toBe(true);
    expect(current.data.fileDataCache[0][1]).toEqual(iqBytes);
    expect(current.data.metadataMap[0][1].format_version).toBe(6);
    const playbackUpdates = current.data.metadataMap[0][1].frame_updates;
    for (const [frameIndex, byteOffset] of [0, 4, 8].entries()) {
      const frame = getIqFrameAtOffset(
        current.data.fileDataCache[0][1],
        byteOffset,
        2,
        playbackUpdates,
      );
      expect(frame?.data).toEqual(iqBytes.slice(byteOffset, byteOffset + 4));
      expect(getIqFrameTimestampAtOffset(playbackUpdates, byteOffset)).toBe(
        (frameIndex + 1) * 1,
      );
    }
    expect(legacy?.type).toBe("result");
    expect(legacy.data.fileDataCache[0][1]).toEqual(iqBytes);
    expect(legacy.data.metadataMap[0][1].format_version).toBe(3);

    const wrongKey = await deriveRawKey("incorrect-passphrase");
    const rejected = await workerResult(
      currentCapture,
      "current-v6.napt",
      wrongKey,
    );
    expect(rejected?.type).toBe("error");
  });

  it("loads and plays FIDO vault NAPT captures whose public frame metadata grows the header past 8 KiB", async () => {
    const fidoVaultKey = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
    const captureIqBytes = new Uint8Array(600 * 4);
    captureIqBytes.set(iqBytes);
    const capture = await makeFidoVaultNapt(fidoVaultKey, captureIqBytes);
    expect(parseNaptMetadata(capture).encryption).toBe("AES-256-GCM-FIDO-VAULT-V1");

    const result = await workerResult(
      capture,
      "fido-vault-large-header.napt",
      await deriveRawKey("ordinary-login-vault-key"),
      fidoVaultKey.slice().buffer,
    );

    expect(result?.type).toBe("result");
    expect(result.data.metadataMap[0][1].encryption).toBe("AES-256-GCM-FIDO-VAULT-V1");
    expect(result.data.fileDataCache[0][1]).toEqual(captureIqBytes);
    const playbackUpdates = result.data.metadataMap[0][1].frame_updates;
    for (const [frameIndex, byteOffset] of [0, 4, 8].entries()) {
      const frame = getIqFrameAtOffset(
        result.data.fileDataCache[0][1],
        byteOffset,
        2,
        playbackUpdates,
      );
      expect(frame?.data).toEqual(iqBytes.slice(byteOffset, byteOffset + 4));
      expect(getIqFrameTimestampAtOffset(playbackUpdates, byteOffset)).toBe(
        (frameIndex + 1) * 1,
      );
    }
  });

  it("decrypts and plays an FIDO vault NAPT-IQ3 capture with the unlocked vault key", async () => {
    const fidoVaultKey = Uint8Array.from({ length: 32 }, (_, index) => index + 121);
    const capture = await makeFidoVaultIq(fidoVaultKey);

    const result = await workerResult(
      capture,
      "fido-vault.iq",
      await deriveRawKey("ordinary-login-vault-key"),
      fidoVaultKey.slice().buffer,
    );

    expect(result?.type).toBe("result");
    expect(result.data.metadataMap[0][1].encryption).toBe("AES-256-GCM-FIDO-VAULT-V1");
    expect(result.data.fileDataCache[0][1]).toEqual(iqBytes);
  });
});

import crypto from "node:crypto";
import { encodeNaptCaptureV4 } from "@n-apt/webusb/iqCaptureFormat";
import { computeHmac, deriveRawKey } from "@n-apt/crypto/webcrypto";
import {
  getIqFrameAtOffset,
  getIqFrameTimestampAtOffset,
} from "@n-apt/capture/hooks/usePlaybackAnimation";
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
});

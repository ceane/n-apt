import { createHash } from "node:crypto";
import {
  encodeIqCaptureV4,
  encodeNaptCaptureV4,
  type IqCaptureFrameUpdate,
} from "@n-apt/webusb/iqCaptureFormat";
import { verifyCaptureArtifact } from "../../scripts/cli/artifact";

const metadata = {
  center_frequency_hz: 1_600_000,
  capture_sample_rate_hz: 3_200_000,
  format: "iq",
  format_version: 5,
  encrypted: false,
  interleaving: "IQ",
};

const frameUpdates: IqCaptureFrameUpdate[] = [
  {
    sample_offset: 0,
    timestamp_us: 0,
    patch: {
      center_frequency_hz: 1_600_000,
      fft_size: 65_536,
      fft_window: "hanning",
    },
  },
];

const checksum = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

async function iqCapture(updates = [frameUpdates[0]]) {
  return encodeIqCaptureV4({
    metadata,
    frameUpdates: updates,
    chunks: [
      { sample_offset: 0, channel: 0, data: Uint8Array.of(128, 127, 129, 126) },
    ],
  });
}

describe("downloaded capture artifact verification", () => {
  it("accepts a V6 IQ artifact with matching external and internal integrity", async () => {
    const bytes = await iqCapture();

    await expect(
      verifyCaptureArtifact(bytes, {
        filename: "capture.iq",
        fileSize: bytes.byteLength,
        checksum: checksum(bytes),
      }),
    ).resolves.toMatchObject({
      format: "iq",
      formatVersion: 6,
      frameUpdateCount: 1,
    });
  });

  it("accepts a V6 NAPT artifact with retained patch history", async () => {
    const bytes = await encodeNaptCaptureV4({
      metadata,
      frameUpdates,
      channels: [
        {
          center_freq_hz: 1_600_000,
          sample_rate_hz: 3_200_000,
          bins_per_frame: 65_536,
        },
      ],
      data: Uint8Array.of(128, 127, 129, 126),
      passphrase: "capture-passphrase",
    });

    await expect(
      verifyCaptureArtifact(bytes, {
        filename: "capture.napt",
        fileSize: bytes.byteLength,
        checksum: checksum(bytes),
      }),
    ).resolves.toMatchObject({
      format: "napt",
      formatVersion: 6,
      frameUpdateCount: 1,
    });
  });

  it("rejects corrupt, patchless, and incorrectly sized downloads", async () => {
    const bytes = await iqCapture();
    const corrupt = bytes.slice();
    corrupt[corrupt.length - 1] ^= 1;

    await expect(
      verifyCaptureArtifact(corrupt, {
        filename: "capture.iq",
        fileSize: corrupt.byteLength,
        checksum: checksum(corrupt),
      }),
    ).rejects.toThrow(/integrity|checksum/i);
    const patchless = await iqCapture([]);
    await expect(
      verifyCaptureArtifact(patchless, {
        filename: "capture.iq",
        fileSize: patchless.byteLength,
        checksum: checksum(patchless),
      }),
    ).rejects.toThrow(/frame update|patch/i);
    await expect(
      verifyCaptureArtifact(bytes, {
        filename: "capture.iq",
        fileSize: bytes.byteLength + 1,
        checksum: checksum(bytes),
      }),
    ).rejects.toThrow(/size/i);
  });
});

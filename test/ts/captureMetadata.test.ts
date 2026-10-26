import {
  isMetadataCaptureFile,
  parseIqCaptureMetadata,
  selectPrimaryMetadataCaptureFile,
} from "@n-apt/capture/captureMetadata";

const makeEncryptedIqCapture = (metadata: Record<string, unknown>) => {
  const encoder = new TextEncoder();
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  const framesBytes = encoder.encode("[]");
  const encryptedPayload = Uint8Array.of(1, 2, 3, 4);
  const bytes = new Uint8Array(
    40 + metadataBytes.byteLength + framesBytes.byteLength + encryptedPayload.byteLength,
  );
  bytes.set(encoder.encode("NAPT-IQ3"), 0);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(8, BigInt(metadataBytes.byteLength), true);
  view.setBigUint64(16, BigInt(framesBytes.byteLength), true);
  view.setBigUint64(24, BigInt(encryptedPayload.byteLength), true);
  view.setUint8(32, 1);
  bytes.set(metadataBytes, 40);
  bytes.set(framesBytes, 40 + metadataBytes.byteLength);
  bytes.set(encryptedPayload, 40 + metadataBytes.byteLength + framesBytes.byteLength);
  return bytes;
};

describe("capture metadata", () => {
  it("recognizes I/Q captures as metadata-bearing files", () => {
    expect(isMetadataCaptureFile("capture.iq")).toBe(true);
    expect(isMetadataCaptureFile("capture.IQ")).toBe(true);
    expect(isMetadataCaptureFile("capture.wav")).toBe(true);
    expect(isMetadataCaptureFile("capture.napt")).toBe(true);
    expect(isMetadataCaptureFile("notes.txt")).toBe(false);
  });

  it("selects a single I/Q file for the playback metadata panel", () => {
    const file = { id: "capture", name: "capture.iq" };
    expect(selectPrimaryMetadataCaptureFile("file", [file])).toBe(file);
    expect(selectPrimaryMetadataCaptureFile("live", [file])).toBeNull();
    expect(selectPrimaryMetadataCaptureFile("file", [file, file])).toBeNull();
  });

  it("reads public metadata from an encrypted FIDO-vault I/Q capture header", () => {
    const bytes = makeEncryptedIqCapture({
      center_frequency_hz: 1_618_000,
      capture_sample_rate_hz: 3_200_000,
      hardware_sample_rate_hz: 3_200_000,
      encrypted: true,
      encryption: "AES-256-GCM-FIDO-VAULT-V1",
      source_device: "RTL-SDR Blog V4",
      timestamp_utc: "2026-10-21T19:15:07.000Z",
      duration_s: 4,
    });

    expect(parseIqCaptureMetadata(bytes)).toMatchObject({
      center_frequency_hz: 1_618_000,
      capture_sample_rate_hz: 3_200_000,
      encrypted: true,
      encryption: "AES-256-GCM-FIDO-VAULT-V1",
      source_device: "RTL-SDR Blog V4",
      duration_s: 4,
    });
  });
});

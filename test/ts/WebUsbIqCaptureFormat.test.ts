import {
  decodeIqCaptureHeader,
  encodeIqCaptureV4,
  encodeNaptCaptureV4,
} from "@n-apt/webusb/iqCaptureFormat";

const metadata = {
  center_frequency_hz: 1_600_000,
  capture_sample_rate_hz: 3_200_000,
  hardware_sample_rate_hz: 3_200_000,
  encrypted: false,
  timestamp_utc: "2026-09-01T00:00:00.000Z",
  frame_rate: 10,
  fft_size: 2048,
  fft_window: "Hanning",
  duration_s: 0.2,
  acquisition_mode: "interleaved",
  source_device: "RTL-SDR Blog V4",
  gain: 49.6,
  ppm: 1,
  tuner_agc: false,
  rtl_agc: false,
  data_format: "iq_u8",
  spectrum_shifted: true,
  device_profile: { kind: "RTL-SDR Blog V4", firmware_version: null },
};

describe("standalone IQ capture containers", () => {
  it("writes an app-compatible NAPT-IQ3 v4 container with chunk offsets", () => {
    const bytes = encodeIqCaptureV4({
      metadata,
      frameUpdates: [
        {
          sample_offset: 0,
          timestamp_us: 0,
          patch: { center_frequency_hz: 1_600_000 },
        },
      ],
      chunks: [
        { sample_offset: 0, channel: 0, data: Uint8Array.of(128, 127, 129, 126) },
        { sample_offset: 2, channel: 0, data: Uint8Array.of(130, 125) },
      ],
    });

    const decoded = decodeIqCaptureHeader(bytes);
    expect(decoded.metadata).toMatchObject({
      format: "iq",
      format_version: 4,
      interleaving: "IQ",
      center_frequency_hz: 1_600_000,
      capture_sample_rate_hz: 3_200_000,
    });
    expect(decoded.frameUpdates).toEqual([
      {
        sample_offset: 0,
        timestamp_us: 0,
        patch: { center_frequency_hz: 1_600_000 },
      },
    ]);
    expect(decoded.payload.byteLength).toBe(46);
    const payloadView = new DataView(
      decoded.payload.buffer,
      decoded.payload.byteOffset,
      decoded.payload.byteLength,
    );
    expect(payloadView.getBigUint64(0, true)).toBe(0n);
    expect(payloadView.getUint32(8, true)).toBe(0);
    expect(payloadView.getBigUint64(12, true)).toBe(4n);
    expect(decoded.payload.slice(20, 24)).toEqual(
      Uint8Array.of(128, 127, 129, 126),
    );
    expect(payloadView.getBigUint64(24, true)).toBe(2n);
    expect(payloadView.getUint32(32, true)).toBe(0);
    expect(payloadView.getBigUint64(36, true)).toBe(2n);
    expect(decoded.payload.slice(44)).toEqual(Uint8Array.of(130, 125));
  });

  it("writes an encrypted v4 NAPT container with indexed binary data", async () => {
    const bytes = await encodeNaptCaptureV4({
      metadata: { ...metadata, encrypted: true },
      channels: [
        {
          center_freq_hz: 1_600_000,
          sample_rate_hz: 3_200_000,
          requested_min_freq_hz: 0,
          requested_max_freq_hz: 3_200_000,
          bins_per_frame: 2048,
          label: null,
        },
      ],
      data: Uint8Array.of(128, 127, 129, 126),
      passphrase: "capture-passphrase",
    });

    const firstLine = new TextDecoder().decode(bytes).split("\n", 1)[0];
    const root = JSON.parse(firstLine) as {
      metadata: Record<string, any>;
    };
    expect(root.metadata).toMatchObject({
      format: "napt",
      format_version: 4,
      encrypted: true,
      data_format: "iq_u8",
      channels: [{ offset_iq: 0, iq_length: 4, label: null }],
    });
    expect(root.metadata.wrapped_dek).toEqual(expect.any(String));
    expect(root.metadata.sections.binary).toMatchObject({
      encoding: "iq_u8_interleaved",
      encrypted: true,
    });
    expect(root.metadata.sections.trailer.encoding).toBe("utf8_json");
    expect(bytes.slice(root.metadata.sections.binary.offset_bytes)).toEqual(
      expect.any(Uint8Array),
    );
  });
});

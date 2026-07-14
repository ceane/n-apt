import {
  resolveRequestedDevice,
  resolveNaptReceiveDefaults,
  hasNaptReceiveDefaults,
  CLI_CAPTURE_DEFAULT_FFT_SIZE,
  resolveCliCaptureFftSize,
  resolveCaptureTarget,
  validateIqCaptureOptions,
} from "@n-apt/capture/policy";

const source = (overrides: Record<string, unknown> = {}) => ({
  id: "rtl-sdr-serial-123",
  name: "RTL-SDR",
  kind: "rtl-sdr",
  capability: "rx" as const,
  status: "connected" as const,
  loading_attempt: 0,
  loading_attempt_max: 3,
  supports_approx_dbm: true,
  supports_raw_iq_stream: true,
  sdr: {
    max_sample_rate: 3200000,
    sample_rate_options: [2400000, 3200000],
    fft_display: { markers: [] },
    settings: {},
  },
  ...overrides,
});

describe("CLI capture policy", () => {
  test("defaults CLI snapshot and I/Q capture processing to a 65,536-point FFT", () => {
    expect(CLI_CAPTURE_DEFAULT_FFT_SIZE).toBe(65_536);
    expect(resolveCliCaptureFftSize([])).toBe(65_536);
  });

  test("accepts an explicit valid CLI FFT size", () => {
    expect(resolveCliCaptureFftSize(["--fft-size", "131072"])).toBe(131_072);
  });

  test("requires an explicit device when auto sees multiple physical devices", () => {
    expect(() =>
      resolveRequestedDevice({
        requested: "auto",
        sources: [source(), source({ id: "hackrf-serial-456", kind: "hackrf_one" })],
      }),
    ).toThrow(/multiple/i);
  });

  test("falls back to Mock APT when no physical device is connected", () => {
    const selected = resolveRequestedDevice({
      requested: "auto",
      sources: [
        source({ id: "rtl-sdr-serial-123", status: "disconnected" }),
        source({
          id: "mock-apt",
          name: "Mock APT SDR",
          kind: "mock_apt",
          capability: "mock",
          status: "connected",
        }),
      ],
    });

    expect(selected.id).toBe("mock-apt");
  });

  test("derives a channel capture target and rejects center frequency with it", () => {
    const capabilities = {
      channels: {
        A: { min: 18000, max: 4470000 },
      },
      sampleRateHz: 3200000,
    };

    expect(resolveCaptureTarget({ channel: "A" }, capabilities)).toEqual({
      channel: "A",
      minHz: 18000,
      maxHz: 3218000,
      centerFrequencyHz: 1618000,
    });

    expect(() =>
      resolveCaptureTarget(
        { channel: "A", centerFrequencyHz: 137500000 },
        capabilities,
      ),
    ).toThrow(/mutually exclusive/i);
  });

  test("does not allow unencrypted NAPT captures", () => {
    expect(() =>
      validateIqCaptureOptions({ fileType: ".napt", encrypted: false }),
    ).toThrow(/always encrypted/i);
  });

  test("defaults an RTL-SDR capture to 46.9 dB and 1 PPM", () => {
    expect(resolveNaptReceiveDefaults(source())).toEqual({
      gainDb: 46.9,
      ppm: 1,
    });
  });

  test("confirms backend gain and PPM before capture", () => {
    const defaults = { gainDb: 46.9, ppm: 1 };
    expect(
      hasNaptReceiveDefaults(
        source({ sdr: { settings: { gain: 46.9, ppm: 1 } } }),
        defaults,
      ),
    ).toBe(true);
    expect(
      hasNaptReceiveDefaults(
        source({ sdr: { settings: { gain: 0, ppm: 0 } } }),
        defaults,
      ),
    ).toBe(false);
  });
});

import { DeviceProfileSchema, SourceInfoSchema } from "@n-apt/validation";

const iqFormat = {
  element_type: "u8" as const,
  layout: "interleaved_iq" as const,
  typed_array: "Uint8Array" as const,
};

describe("IQ format contract", () => {
  it("accepts the current Uint8Array interleaved IQ format", () => {
    expect(
      DeviceProfileSchema.safeParse({
        kind: "opaque-source",
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        iq_format: iqFormat,
      }).success,
    ).toBe(true);
  });

  it("rejects an IQ format that the frontend cannot decode", () => {
    expect(
      DeviceProfileSchema.safeParse({
        kind: "opaque-source",
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        iq_format: {
          element_type: "f32",
          layout: "interleaved_iq",
          typed_array: "Float32Array",
        },
      }).success,
    ).toBe(false);
  });

  it("allows a source without IQ when no IQ stream is advertised", () => {
    expect(
      SourceInfoSchema.safeParse({
        id: "source-1",
        name: "Source",
        kind: "opaque-source",
        capability: "rx",
        status: "connected",
        loading_attempt: 0,
        loading_attempt_max: 0,
        supports_approx_dbm: false,
        sdr: {
          max_sample_rate: 1_000,
          sample_rate_options: [1_000],
          fft_display: { markers: [] },
          settings: {},
        },
      }).success,
    ).toBe(true);
  });
});

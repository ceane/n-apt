import {
  inspectSignalFile,
  validateSignalInput,
  type SignalMetadata,
} from "@n-apt/cli/signalCli";

describe("signal CLI analysis", () => {
  const metadata: SignalMetadata = {
    format: "iq",
    format_version: 4,
    interleaving: "IQ",
    center_frequency_hz: 145_500_000,
    capture_sample_rate_hz: 3_200_000,
    frequency_range: [144_500_000, 146_500_000],
  };

  it("validates the metadata needed for demodulation", () => {
    expect(validateSignalInput(metadata)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(validateSignalInput({ ...metadata, capture_sample_rate_hz: undefined })).toMatchObject({
      valid: false,
      errors: ["capture_sample_rate_hz is required"],
    });
  });

  it("reports a raw IQ file as an analyzable signal input", () => {
    const result = inspectSignalFile(new Uint8Array([1, 2, 3, 4]), "sample.iq");
    expect(result).toMatchObject({
      format: "raw-iq",
      bytes: 4,
      iqSamples: 2,
      warnings: ["Raw IQ input has no frequency or sample-rate metadata"],
    });
  });

  it("reports metadata and sample count for a signal file", () => {
    const metadataBytes = Buffer.from(JSON.stringify(metadata));
    const header = Buffer.alloc(40);
    Buffer.from("NAPT-IQ3").copy(header);
    header.writeBigUInt64LE(BigInt(metadataBytes.length), 8);
    header.writeBigUInt64LE(0n, 16);
    header.writeBigUInt64LE(4n, 24);
    const result = inspectSignalFile(
      Buffer.concat([header, metadataBytes, Buffer.from([1, 2, 3, 4])]),
      "sample.napt",
    );
    expect(result).toMatchObject({ format: "napt-iq", bytes: 4, iqSamples: 2, metadata });
  });
});

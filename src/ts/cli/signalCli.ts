export type SignalMetadata = {
  format?: string;
  format_version?: number;
  interleaving?: string;
  center_frequency_hz?: number;
  capture_sample_rate_hz?: number;
  sample_rate_hz?: number;
  frequency_range?: [number, number];
  data_format?: string;
  encrypted?: boolean;
};

export type SignalInspection = {
  format: "raw-iq" | "napt-iq";
  bytes: number;
  iqSamples: number;
  metadata: SignalMetadata | null;
  warnings: string[];
};

export type SignalValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type SignalSummary = SignalInspection & {
  dcOffset: number;
  peak: number;
  rms: number;
};

export function validateSignalInput(metadata: SignalMetadata | null): SignalValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!metadata) return { valid: false, errors: ["Signal metadata is missing"], warnings };
  if (!Number.isFinite(metadata.capture_sample_rate_hz ?? metadata.sample_rate_hz)) {
    errors.push("capture_sample_rate_hz is required");
  }
  if (!Number.isFinite(metadata.center_frequency_hz)) errors.push("center_frequency_hz is required");
  const range = metadata.frequency_range;
  if (!range || range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[1] <= range[0]) {
    warnings.push("frequency_range is missing or invalid");
  }
  if (metadata.encrypted) warnings.push("Input is encrypted and needs an authorized decryption key");
  return { valid: errors.length === 0, errors, warnings };
}

export function inspectSignalFile(input: Uint8Array, name = "input.iq"): SignalInspection {
  const magic = input.byteLength >= 8 ? new TextDecoder().decode(input.slice(0, 8)) : "";
  if (magic !== "NAPT-IQ3") {
    return {
      format: "raw-iq",
      bytes: input.byteLength,
      iqSamples: Math.floor(input.byteLength / 2),
      metadata: null,
      warnings: ["Raw IQ input has no frequency or sample-rate metadata"],
    };
  }
  if (input.byteLength < 40) throw new Error("Invalid IQ v3 header");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const metadataLength = Number(view.getBigUint64(8, true));
  const framesLength = Number(view.getBigUint64(16, true));
  const payloadLength = Number(view.getBigUint64(24, true));
  const payloadStart = 40 + metadataLength + framesLength;
  if (payloadStart + payloadLength > input.byteLength) throw new Error(`Truncated IQ file: ${name}`);
  const metadata = JSON.parse(new TextDecoder().decode(input.slice(40, 40 + metadataLength))) as SignalMetadata;
  const validation = validateSignalInput(metadata);
  return {
    format: "napt-iq",
    bytes: payloadLength,
    iqSamples: Math.floor(payloadLength / 2),
    metadata,
    warnings: validation.warnings,
  };
}

export function summarizeSignal(input: Uint8Array, name = "input.iq"): SignalSummary {
  const inspection = inspectSignalFile(input, name);
  const sampleCount = Math.floor(input.length / 2);
  if (sampleCount === 0) return { ...inspection, dcOffset: 0, peak: 0, rms: 0 };
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const i = (input[index * 2] - 127.5) / 127.5;
    const q = (input[index * 2 + 1] - 127.5) / 127.5;
    const magnitude = Math.hypot(i, q);
    sum += magnitude;
    sumSquares += magnitude * magnitude;
    peak = Math.max(peak, magnitude);
  }
  return {
    ...inspection,
    dcOffset: sum / sampleCount,
    peak,
    rms: Math.sqrt(sumSquares / sampleCount),
  };
}

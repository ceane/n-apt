import type { SourceInfo } from "@n-apt/consts/schemas/websocket";

export type CaptureSource = Pick<SourceInfo, "id" | "kind" | "capability" | "status">;

export interface ChannelCapability {
  min: number;
  max: number;
}

export interface CaptureCapabilities {
  channels: Record<string, ChannelCapability>;
  sampleRateHz: number;
}

export interface CaptureTarget {
  channel?: string;
  minHz: number;
  maxHz: number;
  centerFrequencyHz: number;
}

export interface NaptReceiveDefaults {
  gainDb: number;
  ppm: number;
}

/** Default FFT size for every headless CLI capture workflow. */
export const CLI_CAPTURE_DEFAULT_FFT_SIZE = 65_536;

/**
 * Resolves the FFT size shared by snapshot and I/Q CLI captures. Keeping this
 * outside the CLI entry point prevents the two workflows from drifting apart.
 */
export function resolveCliCaptureFftSize(args: readonly string[]): number {
  const index = args.indexOf("--fft-size");
  if (index < 0) return CLI_CAPTURE_DEFAULT_FFT_SIZE;

  const fftSize = Number(args[index + 1]);
  if (
    !Number.isSafeInteger(fftSize) ||
    fftSize < 256 ||
    fftSize > 8_388_608 ||
    (fftSize & (fftSize - 1)) !== 0
  ) {
    throw new Error("--fft-size must be a power of two from 256 through 8388608");
  }
  return fftSize;
}

/**
 * Resolves N-APT's receive defaults for a selected source. RTL-SDR uses its
 * maximum supported manual tuner gain and the frequency correction required
 * by the N-APT signal profile. Other devices retain backend-resolved values.
 */
export function resolveNaptReceiveDefaults(source: {
  kind: string;
  sdr?: {
    settings?: {
      gain?: number | { tuner_gain?: number };
      ppm?: number;
    };
  };
}): NaptReceiveDefaults {
  const isRtlSdr = ["rtl-sdr", "rtl_sdr"].includes(source.kind);
  const configuredGain = source.sdr?.settings?.gain;
  const gainDb =
    typeof configuredGain === "number"
      ? configuredGain
      : configuredGain?.tuner_gain;

  return {
    gainDb: isRtlSdr ? 46.9 : (gainDb ?? 46.9),
    ppm: isRtlSdr ? 1 : (source.sdr?.settings?.ppm ?? 1),
  };
}

/** Returns true only when Rust reports the requested manual receive values. */
export function hasNaptReceiveDefaults(
  source: {
    sdr?: {
      settings?: {
        gain?: number | { tuner_gain?: number };
        ppm?: number;
      };
    };
  },
  defaults: NaptReceiveDefaults,
): boolean {
  const configuredGain = source.sdr?.settings?.gain;
  const gainDb =
    typeof configuredGain === "number"
      ? configuredGain
      : configuredGain?.tuner_gain;
  return gainDb === defaults.gainDb && source.sdr?.settings?.ppm === defaults.ppm;
}

const isMock = (source: CaptureSource) =>
  source.capability === "mock" || source.id === "mock-apt" || source.kind.includes("mock");

const isConnectedPhysical = (source: CaptureSource) =>
  (source.status === "connected" || source.status === "streaming") && !isMock(source);

/**
 * Selects a stable backend source ID for a CLI operation.
 *
 * `auto` selects the only connected physical device, falls back to Mock APT
 * when no physical device is connected, and rejects ambiguity when multiple
 * physical devices are available. Explicit IDs must be connected.
 */
export function resolveRequestedDevice({
  requested,
  sources,
}: {
  requested: string;
  sources: CaptureSource[];
}): CaptureSource {
  const physical = sources.filter(isConnectedPhysical);
  const mock = sources.find(
    (source) =>
      isMock(source) &&
      (source.status === "connected" || source.status === "streaming"),
  );

  if (requested !== "auto") {
    const selected = sources.find((source) => source.id === requested);
    if (
      !selected ||
      (selected.status !== "connected" && selected.status !== "streaming")
    ) {
      throw new Error(`Device '${requested}' is unavailable`);
    }
    return selected;
  }

  if (physical.length > 1) {
    throw new Error("Multiple physical devices are available; specify --device");
  }
  return physical[0] ?? mock ?? (() => {
    throw new Error("No connected physical device or Mock APT source is available");
  })();
}

/**
 * Resolves either a configured channel or an explicit center frequency.
 * Channels and center frequencies are mutually exclusive. A channel range
 * is capped at its configured start plus the active sample-rate span.
 */
export function resolveCaptureTarget(
  options: { channel?: string; centerFrequencyHz?: number },
  capabilities: CaptureCapabilities,
): CaptureTarget {
  if (options.channel && options.centerFrequencyHz !== undefined) {
    throw new Error("--channel and --center-frequency are mutually exclusive");
  }

  if (options.channel) {
    const bounds = capabilities.channels[options.channel];
    if (!bounds) throw new Error(`Unknown channel '${options.channel}'`);
    const maxHz = Math.min(bounds.max, bounds.min + capabilities.sampleRateHz);
    return {
      channel: options.channel,
      minHz: bounds.min,
      maxHz,
      centerFrequencyHz: bounds.min + (maxHz - bounds.min) / 2,
    };
  }

  const center = options.centerFrequencyHz;
  if (center === undefined) {
    return resolveCaptureTarget({ channel: "A" }, capabilities);
  }

  if (!Number.isFinite(center) || center <= 0) {
    throw new Error("--center-frequency must be a positive finite frequency");
  }
  const halfRate = capabilities.sampleRateHz / 2;
  return {
    minHz: center - halfRate,
    maxHz: center + halfRate,
    centerFrequencyHz: center,
  };
}

/**
 * Validates file/encryption combinations before a capture starts.
 * `.napt` artifacts are always encrypted and cannot be requested unencrypted.
 */
export function validateIqCaptureOptions(options: {
  fileType?: ".napt" | ".wav";
  encrypted?: boolean;
}): void {
  if (options.fileType === ".napt" && options.encrypted === false) {
    throw new Error(".napt captures are always encrypted");
  }
}

export type SpectrumPlaceholderState =
  | {
      kind: "disconnected" | "loading";
      kicker: string;
      title: string;
      message: string;
      source: string;
    }
  | {
      kind: "error";
      kicker: "Error";
      title: string;
      message: string;
      source: string;
    };

export function getSpectrumPlaceholderState(
  connected: boolean,
  error?: unknown,
): SpectrumPlaceholderState | null {
  if (error !== undefined && error !== null) {
    return {
      kind: "error",
      kicker: "Error",
      title: "No device available",
      message: "Connect your SDR (RTL-SDR) to start streaming.",
      source: "WebUSB",
    };
  }

  if (connected) return null;

  return {
    kind: "disconnected",
    kicker: "Standby",
    title: "Waiting for RTL-SDR",
    message: "Connect an RTL-SDR to start the live FFT.",
    source: "WebUSB",
  };
}

export function getSpectrumLoadingPlaceholder(): SpectrumPlaceholderState {
  return {
    kind: "loading",
    kicker: "Connecting",
    title: "Connecting to RTL-SDR",
    message: "Waiting for the first frame to arrive.",
    source: "WebUSB",
  };
}

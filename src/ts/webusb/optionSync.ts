export type OptionSyncState = "idle" | "pending" | "sent" | "local" | "error";

export type RtlOptionKey =
  | "centerFrequency"
  | "sampleRate"
  | "fftSize"
  | "gain"
  | "ppm";

export interface OptionSyncIndicator {
  symbol: string;
  label: string;
}

export function getOptionSyncIndicator(
  state: OptionSyncState,
): OptionSyncIndicator {
  switch (state) {
    case "pending":
      return { symbol: "⟳", label: "Applying" };
    case "sent":
      return { symbol: "✓", label: "Applied" };
    case "local":
      return { symbol: "•", label: "Local" };
    case "error":
      return { symbol: "×", label: "Error" };
    case "idle":
    default:
      return { symbol: "—", label: "Not connected" };
  }
}

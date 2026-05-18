import { formatFrequency } from "@n-apt/consts/sdr";
import type { SdrSettingsConfig } from "@n-apt/hooks/useWebSocket";

export type SdrLimitMarker = {
  freq: number;
  label: string;
  kind?: string;
};

export function buildSdrLimitMarkers(
  sdrSettings: SdrSettingsConfig | null | undefined,
  deviceMarkers?: Array<{
    kind: string;
    freq_hz: number;
    label?: string;
  }> | null,
): SdrLimitMarker[] {
  if (deviceMarkers?.length) {
    return deviceMarkers.reduce<SdrLimitMarker[]>((acc, marker) => {
      if (Number.isFinite(marker.freq_hz) && marker.freq_hz >= 0) {
        acc.push({
          freq: marker.freq_hz,
          kind: marker.kind,
          label:
            marker.label ??
            `${formatFrequency(marker.freq_hz)} / ${marker.kind.split("_").join(" ")}`,
        });
      }
      return acc;
    }, []);
  }

  const limits = sdrSettings?.limits;
  if (!limits) return [];

  const markers: SdrLimitMarker[] = [];

  if (typeof limits.lower_limit_hz === "number") {
    markers.push({
      freq: limits.lower_limit_hz,
      kind: "lower_limit",
      label:
        limits.lower_limit_label ??
        `${formatFrequency(limits.lower_limit_hz)} / Lower limit`,
    });
  }

  if (typeof limits.upper_limit_hz === "number") {
    markers.push({
      freq: limits.upper_limit_hz,
      kind: "upper_limit",
      label:
        limits.upper_limit_label ??
        `${formatFrequency(limits.upper_limit_hz)} / Upper limit`,
    });
  }

  return markers;
}

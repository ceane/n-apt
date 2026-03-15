import { formatFrequency } from "@n-apt/consts/sdr";
import type { SdrSettingsConfig } from "@n-apt/hooks/useWebSocket";

export type SdrLimitMarker = {
  freq: number;
  label: string;
};

export function buildSdrLimitMarkers(
  sdrSettings: SdrSettingsConfig | null | undefined,
): SdrLimitMarker[] {
  const limits = sdrSettings?.limits;
  if (!limits) return [];

  const markers: SdrLimitMarker[] = [];

  if (typeof limits.lower_limit_mhz === "number") {
    markers.push({
      freq: limits.lower_limit_mhz,
      label:
        limits.lower_limit_label ??
        `${formatFrequency(limits.lower_limit_mhz)} / Lower limit`,
    });
  }

  if (typeof limits.upper_limit_mhz === "number") {
    markers.push({
      freq: limits.upper_limit_mhz,
      label:
        limits.upper_limit_label ??
        `${formatFrequency(limits.upper_limit_mhz)} / Upper limit`,
    });
  }

  return markers;
}

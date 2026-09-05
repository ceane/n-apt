import { formatFrequency } from "@n-apt/consts/sdr";

export type SdrLimitMarker = {
  freq: number;
  label: string;
  kind?: string;
};

export function buildSdrLimitMarkers(
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

  return [];
}

import { useEffect } from "react";
import type { SDRSettings } from "@n-apt/consts/schemas/websocket";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

interface UseSnapshotListenerOptions {
  takeSnapshot: (options: SnapshotOptions) => void;
  snapshotGridPreference: boolean;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  sourceMode: "live" | "file";
  backend?: string;
  deviceInfo?: string;
  effectiveSdrSettings?: SDRSettings;
  deviceName?: string;
  captureWholeChannelSegments: () => Promise<Array<{
    data: SnapshotData;
    visualRange: { min: number; max: number };
  }>>;
  getSnapshotData: () => SnapshotData | null;
}

interface SnapshotOptions {
  whole?: boolean;
  grid?: boolean;
  showGeolocation?: boolean;
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  [key: string]: any;
}

/**
 * Hook for handling snapshot events from the sidebar
 * Manages the 'napt-snapshot' custom event listener
 */
export const useSnapshotListener = ({
  takeSnapshot,
  snapshotGridPreference,
  signalAreaBounds,
  activeSignalArea,
  sourceMode,
  backend,
  deviceInfo,
  effectiveSdrSettings,
  deviceName,
  captureWholeChannelSegments,
  getSnapshotData,
}: UseSnapshotListenerOptions) => {
  useEffect(() => {
    const listener = async (e: Event) => {
      const options = (e as CustomEvent).detail;
      let sdrSettingsLabel: string | undefined;

      if (effectiveSdrSettings) {
        const agcOn =
          effectiveSdrSettings.gain?.rtl_agc ||
          effectiveSdrSettings.gain?.tuner_agc;
        const gainStr = agcOn
          ? "Auto"
          : effectiveSdrSettings.gain?.tuner_gain
            ? `${effectiveSdrSettings.gain.tuner_gain} dB`
            : "N/A";
        const ppmStr =
          effectiveSdrSettings.ppm !== undefined
            ? effectiveSdrSettings.ppm.toString()
            : "0";
        sdrSettingsLabel = `Gain: ${gainStr} | PPM: ${ppmStr}`;
      }

      const modeLabel = options.whole ? "Whole Channel" : "Onscreen";
      const wholeChannelSegments =
        options.whole && sourceMode === "live"
          ? await captureWholeChannelSegments()
          : [];

      takeSnapshot({
        ...options,
        modeLabel,
        wholeChannelSegments,
        showGrid: options.grid ?? snapshotGridPreference,
        getSnapshotData: () => getSnapshotData(), // Use the provided function
        signalAreaBounds,
        activeSignalArea,
        sourceName: deviceName || backend || deviceInfo || undefined,
        sdrSettingsLabel,
        showGeolocation: options.showGeolocation,
        geolocation: options.geolocation,
      });
    };

    window.addEventListener("napt-snapshot", listener);
    return () => window.removeEventListener("napt-snapshot", listener);
  }, [
    takeSnapshot,
    snapshotGridPreference,
    signalAreaBounds,
    activeSignalArea,
    sourceMode,
    backend,
    deviceInfo,
    effectiveSdrSettings,
    captureWholeChannelSegments,
    deviceName,
    getSnapshotData,
  ]);
};

import { useEffect } from "react";
import type { SdrSettingsConfig } from "@n-apt/consts/schemas/websocket";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { SnapshotOptions } from "@n-apt/hooks/useSnapshot";

interface UseSnapshotListenerOptions {
  takeSnapshot: (options: SnapshotOptions) => void;
  snapshotGridPreference: boolean;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  sourceMode: "live" | "file";
  backend?: string;
  deviceInfo?: string;
  effectiveSdrSettings?: SdrSettingsConfig;
  deviceName?: string;
  captureWholeChannelSegments: () => Promise<Array<{
    data: SnapshotData;
    visualRange: { min: number; max: number };
  }>>;
  getSnapshotData: () => SnapshotData | null | undefined;
  getVideoSourceCanvases?: () => {
    spectrum: HTMLCanvasElement | null;
    waterfall: HTMLCanvasElement | null;
  };
  refreshVideoFrame?: () => void;
  prepareVideoRecording?: () => (() => void) | undefined;
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
  getVideoSourceCanvases,
  refreshVideoFrame,
  prepareVideoRecording,
}: UseSnapshotListenerOptions) => {
  useEffect(() => {
    let isProcessing = false;
    
    const listener = async (e: Event) => {
      // Prevent duplicate processing
      if (isProcessing) {
        console.warn('[useSnapshotListener] Ignoring duplicate event - already processing');
        return;
      }
      isProcessing = true;
      
      try {
        const options = (e as CustomEvent).detail;
        let sdrSettingsLabel: string | undefined;

        if (effectiveSdrSettings) {
          const gainValue = typeof effectiveSdrSettings.gain === "number"
            ? effectiveSdrSettings.gain
            : null;
          const gainStr = gainValue !== null ? `${gainValue} dB` : "Auto";
          const ppmStr =
            effectiveSdrSettings.ppm !== undefined
              ? effectiveSdrSettings.ppm.toString()
              : "0";
          sdrSettingsLabel = `Gain: ${gainStr} | PPM: ${ppmStr}`;
        }

        const modeLabel = options.whole ? "Whole Channel" : "Onscreen";
        
        // Capture whole channel segments once (for both PNG and video)
        let wholeChannelSegments: Array<{ data: SnapshotData; visualRange: { min: number; max: number } }> = [];
        if (options.whole && sourceMode === "live") {
          wholeChannelSegments = await captureWholeChannelSegments();
        }

        takeSnapshot({
          ...options,
          modeLabel,
          wholeChannelSegments,
          showGrid: options.grid ?? snapshotGridPreference,
          getSnapshotData: () => getSnapshotData(),
          signalAreaBounds,
          activeSignalArea,
          sourceName: deviceName || backend || deviceInfo || undefined,
          sdrSettingsLabel,
          showGeolocation: options.showGeolocation,
          geolocation: options.geolocation,
          getVideoSourceCanvases,
          refreshVideoFrame,
          prepareVideoRecording,
        });
      } finally {
        isProcessing = false;
      }
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

import { useEffect } from "react";
import type { SdrSettingsConfig } from "@n-apt/consts/schemas/websocket";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { SnapshotOptions } from "@n-apt/hooks/useSnapshot";
import { formatFrequency } from "@n-apt/utils/frequency";
import {
  streamWholeChannelSegmentFrames,
  type WholeChannelSnapshotSegment,
} from "@n-apt/hooks/useCaptureWholeChannelSegments";
import { setSnapshotProgress, useAppDispatch } from "@n-apt/redux";

export const buildSnapshotSettingsLabel = (params: {
  effectiveSdrSettings?: SdrSettingsConfig;
  hackrfLnaGain?: number | null;
  hackrfVgaGain?: number | null;
  hackrfAmpEnabled?: boolean | null;
  hackrfBasebandBandwidth?: number | null;
  deviceKind?: string;
}): string | undefined => {
  const {
    effectiveSdrSettings,
    hackrfLnaGain,
    hackrfVgaGain,
    hackrfAmpEnabled,
    hackrfBasebandBandwidth,
    deviceKind,
  } = params;
  if (!effectiveSdrSettings) return undefined;

  const gainConfig = effectiveSdrSettings.gain;
  const isHackrf = deviceKind === "hackrf_one";
  const hasHackrfControls =
    isHackrf &&
    (hackrfLnaGain != null ||
      hackrfVgaGain != null ||
      hackrfAmpEnabled != null ||
      gainConfig?.hackrf_lna_gain != null ||
      gainConfig?.hackrf_vga_gain != null ||
      gainConfig?.hackrf_amp_enable != null ||
      hackrfBasebandBandwidth != null);

  const gainStr = hasHackrfControls
    ? `LNA ${hackrfLnaGain ?? gainConfig?.hackrf_lna_gain ?? 0}dB | VGA ${
        hackrfVgaGain ?? gainConfig?.hackrf_vga_gain ?? 0
      }dB | AMP ${
        (hackrfAmpEnabled ?? gainConfig?.hackrf_amp_enable) ? "on" : "off"
      }`
    : gainConfig?.tuner_gain != null
      ? `${gainConfig.tuner_gain}dB`
      : "Auto";

  const basebandFilterStr =
    isHackrf && hackrfBasebandBandwidth != null
      ? hackrfBasebandBandwidth > 0
        ? `${formatFrequency(hackrfBasebandBandwidth, {
            precisionMHz: 2,
            precisionKHz: 0,
            trimTrailingZeros: true,
            showUnits: false,
          })} MHz`
        : "off"
      : null;

  const parts = [`Gain: ${gainStr}`];
  if (isHackrf && hasHackrfControls && basebandFilterStr) {
    parts.push(`Baseband Filter: ${basebandFilterStr}`);
  }

  const ppmStr =
    effectiveSdrSettings.ppm !== undefined
      ? effectiveSdrSettings.ppm.toString()
      : "0";
  parts.push(`PPM: ${ppmStr}`);
  return parts.join(" | ");
};

interface UseSnapshotListenerOptions {
  takeSnapshot: (options: SnapshotOptions) => void;
  snapshotGridPreference: boolean;
  snapshotUseThemeColors?: boolean;
  signalAreaBounds?: Record<string, { min: number; max: number }> | null;
  activeSignalArea?: string;
  sourceMode: "live" | "file";
  backend?: string;
  deviceInfo?: string;
  effectiveSdrSettings?: SdrSettingsConfig;
  hackrfLnaGain?: number | null;
  hackrfVgaGain?: number | null;
  hackrfAmpEnabled?: boolean | null;
  hackrfBasebandBandwidth?: number | null;
  deviceName?: string;
  deviceProfile?: any;
  fftFrameRate: number;
  captureWholeChannelSegments: () => Promise<WholeChannelSnapshotSegment[]>;
  getSnapshotData: () => SnapshotData | null | undefined;
  getVideoSourceCanvases?: () => {
    spectrum: HTMLCanvasElement | null;
    spectrumOverlay?: HTMLCanvasElement | null;
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
  snapshotUseThemeColors,
  signalAreaBounds,
  activeSignalArea,
  sourceMode,
  backend,
  deviceInfo,
  effectiveSdrSettings,
  hackrfLnaGain,
  hackrfVgaGain,
  hackrfAmpEnabled,
  hackrfBasebandBandwidth,
  deviceName,
  deviceProfile,
  fftFrameRate,
  captureWholeChannelSegments,
  getSnapshotData,
  getVideoSourceCanvases,
  refreshVideoFrame,
  prepareVideoRecording,
}: UseSnapshotListenerOptions) => {
  const dispatchProgress = useAppDispatch();

  useEffect(() => {
    const listener = async (e: Event) => {
      const options = (e as CustomEvent).detail;
      dispatchProgress(
        setSnapshotProgress({
          stage: "started",
          message: "Preparing snapshot",
          current: null,
          total: null,
        }),
      );
      const sdrSettingsLabel = buildSnapshotSettingsLabel({
        effectiveSdrSettings,
        hackrfLnaGain,
        hackrfVgaGain,
        hackrfAmpEnabled,
        hackrfBasebandBandwidth,
        deviceKind: deviceProfile?.kind,
      });

      const modeLabel = options.whole ? "Whole Channel" : "Onscreen";
      const isVideo = options.format === "mp4" || options.format === "webm";
      const wholeChannelSegments =
        options.whole && sourceMode === "live" && !isVideo
          ? await captureWholeChannelSegments()
          : [];

      takeSnapshot({
        ...options,
        modeLabel,
        wholeChannelSegments,
        showGrid: options.grid ?? snapshotGridPreference,
        useThemeColors: options.useThemeColors ?? snapshotUseThemeColors,
        getSnapshotData: () => getSnapshotData(), // Use the provided function
        signalAreaBounds,
        activeSignalAreaBounds:
          options.activeSignalAreaBounds ??
          (activeSignalArea
            ? (signalAreaBounds?.[activeSignalArea] ??
              signalAreaBounds?.[activeSignalArea.toLowerCase()])
            : null),
        activeSignalArea,
        sourceName: deviceName || backend || deviceInfo || undefined,
        sdrSettingsLabel,
        showGeolocation: options.showGeolocation,
        geolocation: options.geolocation,
        videoFrameRate: isVideo ? 30 : fftFrameRate,
        getWholeChannelSegmentFrames:
          options.whole && sourceMode === "live" && isVideo
            ? () =>
                streamWholeChannelSegmentFrames(captureWholeChannelSegments, 30)
            : undefined,
        getVideoSourceCanvases,
        refreshVideoFrame,
        prepareVideoRecording,
      });
    };

    window.addEventListener("napt-snapshot", listener);
    return () => window.removeEventListener("napt-snapshot", listener);
  }, [
    takeSnapshot,
    snapshotGridPreference,
    snapshotUseThemeColors,
    signalAreaBounds,
    activeSignalArea,
    sourceMode,
    backend,
    deviceInfo,
    effectiveSdrSettings,
    hackrfLnaGain,
    hackrfVgaGain,
    hackrfAmpEnabled,
    hackrfBasebandBandwidth,
    deviceProfile,
    dispatchProgress,
    fftFrameRate,
    captureWholeChannelSegments,
    deviceName,
    getSnapshotData,
  ]);
};

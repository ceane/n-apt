import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FFTCanvasHandle } from "@n-apt/spectrum";
import { useGeolocation } from "@n-apt/maps/public/useGeolocation";
import { reverseGeocodeSnapshotLocation } from "@n-apt/capture/snapshotLocation";
import { getSettingsDefaults } from "@n-apt/settings/public/settingsDefaults";
import {
  buildSnapshotSettingsLabel,
} from "@n-apt/capture/hooks/useSnapshotListener";
import type { useSnapshot } from "@n-apt/capture/hooks/useSnapshot";
import {
  FAST_SPECTRUM_FALLBACK_HEIGHT,
  FAST_WATERFALL_FALLBACK_HEIGHT,
  FastSnapshotControl,
} from "../SpectrumRouteControls";

type SnapshotApi = ReturnType<typeof useSnapshot>;

export interface UseFastSnapshotControlsOptions {
  fftCanvasRef: React.RefObject<FFTCanvasHandle | null>;
  fftSnapshotLoading: boolean;
  isRecording: SnapshotApi["isRecording"];
  recordingCountdown: SnapshotApi["recordingCountdown"];
  supportedVideoFormat: SnapshotApi["supportedVideoFormat"];
  takeFastSnapshot: SnapshotApi["takeFastSnapshot"];
  startFastRecording: SnapshotApi["startFastRecording"];
  stopFastRecording: SnapshotApi["stopFastRecording"];
  getCanvases: () => {
    spectrumGpu: HTMLCanvasElement | null;
    spectrumOverlay: HTMLCanvasElement | null;
    waterfallGpu: HTMLCanvasElement | null;
    waterfallOverlay: HTMLCanvasElement | null;
  } | null;
  effectiveSdrSettings: Record<string, unknown> | null | undefined;
  deviceKind: string | null;
  deviceProfileKind?: string | null;
  selectedSourceDeviceProfileKind?: string | null;
  selectedSourceDeviceName?: string | null;
  deviceName?: string | null;
  isConnected: boolean;
  activeSignalArea: string;
  activeSignalAreaBounds: { min: number; max: number } | null;
  signalAreaBounds: Record<string, { min: number; max: number }> | null;
  gain?: number | null;
  ppm?: number | null;
  hackrfLnaGain?: number | null;
  hackrfVgaGain?: number | null;
  hackrfAmpEnabled?: boolean;
  hackrfBasebandBandwidth?: number | null;
  fftSize?: number | null;
}

/**
 * Fast-snapshot controls: stats/geo mode cycling, geolocation permission
 * probing, and the memoized per-canvas snapshot actions. Extracted verbatim
 * from SpectrumRoute; owns no tuning or lifecycle concerns.
 */
export const useFastSnapshotControls = (
  options: UseFastSnapshotControlsOptions,
): { fastSpectrumSnapshotAction: React.ReactNode; fastWaterfallSnapshotAction: React.ReactNode } => {
  const {
    fftCanvasRef,
    fftSnapshotLoading,
    isRecording,
    recordingCountdown,
    supportedVideoFormat,
    takeFastSnapshot,
    startFastRecording,
    stopFastRecording,
    getCanvases,
    effectiveSdrSettings,
    deviceKind,
    deviceProfileKind,
    selectedSourceDeviceProfileKind,
    selectedSourceDeviceName,
    deviceName,
    isConnected,
    activeSignalArea,
    activeSignalAreaBounds,
    signalAreaBounds,
    gain,
    ppm,
    hackrfLnaGain,
    hackrfVgaGain,
    hackrfAmpEnabled,
    hackrfBasebandBandwidth,
    fftSize,
  } = options;

  const [fastSnapshotMode, setFastSnapshotMode] = useState<0 | 1 | 2>(() =>
    getSettingsDefaults().snapshot.fastSnapshotShowStats ? 1 : 0,
  );
  const { getLocation: getFastSnapshotLocation } = useGeolocation();
  const [fastSnapshotGeolocation, setFastSnapshotGeolocation] = useState<{
    lat: string;
    lon: string;
  } | null>(null);
  const [fastSnapshotLocationLabel, setFastSnapshotLocationLabel] = useState<
    string | null
  >(null);
  const [fastSnapshotGeoUnavailable, setFastSnapshotGeoUnavailable] =
    useState(false);
  const fastSnapshotGeoUnavailableRef = useRef(false);
  const fastSnapshotGeolocationRequestRef = useRef(0);
  const fastSnapshotShowStats = fastSnapshotMode > 0;
  const fastSnapshotShowGeolocation = fastSnapshotMode === 2;
  const handleShowStatsChange = useCallback(
    (show: boolean) => setFastSnapshotMode(show ? 1 : 0),
    [],
  );

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== "function"
    ) {
      return;
    }

    let active = true;
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (!active || permission.state !== "denied") return;
        fastSnapshotGeoUnavailableRef.current = true;
        setFastSnapshotGeoUnavailable(true);
      })
      .catch(() => {
        // The geolocation request remains the fallback for browsers that do
        // not support querying this permission on load.
      });

    return () => {
      active = false;
    };
  }, []);

  const cycleFastSnapshotMode = useCallback(
    (selectedMode?: 0 | 1 | 2) => {
      if (selectedMode === 2) {
        if (fastSnapshotGeoUnavailableRef.current) {
          fastSnapshotGeoUnavailableRef.current = false;
          setFastSnapshotGeoUnavailable(false);
          setFastSnapshotGeolocation(null);
          setFastSnapshotLocationLabel(null);
          setFastSnapshotMode(0);
          return;
        }
        const requestId = ++fastSnapshotGeolocationRequestRef.current;
        void getFastSnapshotLocation()
          .then((location) => {
            if (requestId !== fastSnapshotGeolocationRequestRef.current) return;
            if (!location) {
              fastSnapshotGeoUnavailableRef.current = true;
              setFastSnapshotGeolocation(null);
              setFastSnapshotLocationLabel(null);
              setFastSnapshotMode(1);
              return;
            }

            const geolocation = {
              lat: location.latitude.toFixed(6),
              lon: location.longitude.toFixed(6),
            };
            fastSnapshotGeoUnavailableRef.current = false;
            setFastSnapshotGeoUnavailable(false);
            setFastSnapshotGeolocation(geolocation);
            setFastSnapshotMode(2);
            void reverseGeocodeSnapshotLocation(
              geolocation.lat,
              geolocation.lon,
            )
              .then((label) => {
                if (requestId === fastSnapshotGeolocationRequestRef.current) {
                  setFastSnapshotLocationLabel(label);
                }
              })
              .catch(() => {
                if (requestId === fastSnapshotGeolocationRequestRef.current) {
                  setFastSnapshotLocationLabel(null);
                }
              });
          })
          .catch(() => {
            if (requestId !== fastSnapshotGeolocationRequestRef.current) return;
            fastSnapshotGeoUnavailableRef.current = true;
            setFastSnapshotGeolocation(null);
            setFastSnapshotLocationLabel(null);
            setFastSnapshotMode(1);
          });
        return;
      }

      fastSnapshotGeolocationRequestRef.current += 1;
      setFastSnapshotGeolocation(null);
      setFastSnapshotLocationLabel(null);
      setFastSnapshotMode((current) =>
        selectedMode === undefined
          ? (((current + 1) % 3) as 0 | 1 | 2)
          : selectedMode,
      );
    },
    [getFastSnapshotLocation],
  );

  const buildFastSnapshotControl = useCallback(
    (target: "spectrum" | "waterfall") => {
      const isSpectrum = target === "spectrum";
      const fallbackHeight = isSpectrum
        ? FAST_SPECTRUM_FALLBACK_HEIGHT
        : FAST_WATERFALL_FALLBACK_HEIGHT;
      const getTargetCanvas = () =>
        isSpectrum
          ? fftCanvasRef.current?.getSpectrumCanvas()
          : fftCanvasRef.current?.getWaterfallCanvas();

      const sdrSettingsLabel = buildSnapshotSettingsLabel({
        effectiveSdrSettings,
        gain,
        ppm,
        hackrfLnaGain,
        hackrfVgaGain,
        hackrfAmpEnabled,
        hackrfBasebandBandwidth: hackrfBasebandBandwidth ?? undefined,
        deviceKind:
          selectedSourceDeviceProfileKind ?? deviceProfileKind ?? deviceKind ?? undefined,
      });
      const sourceName =
        selectedSourceDeviceName ?? deviceName ?? (isConnected ? "SDR" : "Offline");

      const snapshotOptions = {
        showStats: fastSnapshotShowStats,
        showGeolocation: fastSnapshotShowGeolocation,
        geolocation: fastSnapshotGeolocation,
        locationLabel: fastSnapshotLocationLabel,
        activeSignalArea,
        activeSignalAreaBounds,
        sourceName,
        sdrSettingsLabel,
        gain: gain ?? undefined,
        ppm: ppm ?? undefined,
        fftSize: fftSize ?? undefined,
      };

      return (
        <FastSnapshotControl
          disabled={
            fftSnapshotLoading ||
            (isRecording !== null && isRecording !== target)
          }
          isRecording={isRecording === target}
          recordingCountdown={recordingCountdown}
          videoFormat={supportedVideoFormat}
          showStats={fastSnapshotShowStats}
          onShowStatsChange={handleShowStatsChange}
          fastSnapshotMode={
            fastSnapshotGeoUnavailable ? undefined : fastSnapshotMode
          }
          onFastSnapshotModeChange={
            fastSnapshotGeoUnavailable ? undefined : cycleFastSnapshotMode
          }
          onImage={() => {
            // Read dimensions at click time — canvas size changes with layout
            // and must not be baked into the memoized element.
            const canvas = getTargetCanvas();
            void takeFastSnapshot(
              target,
              (dataOptions) =>
                fftCanvasRef.current?.getSnapshotData(dataOptions) ?? null,
              canvas?.width ?? 1,
              canvas?.height ?? fallbackHeight,
              getCanvases,
              snapshotOptions,
            );
          }}
          onVideo={() =>
            startFastRecording(
              target,
              (dataOptions) =>
                fftCanvasRef.current?.getSnapshotData(dataOptions) ?? null,
              () => {
                const canvas = getTargetCanvas();
                return {
                  width: canvas?.width ?? 1,
                  height: canvas?.height ?? fallbackHeight,
                };
              },
              isSpectrum ? "fast-fft-recording" : "fast-waterfall-recording",
              getCanvases,
              {
                ...snapshotOptions,
                getActiveSignalArea: () => activeSignalArea,
                getActiveSignalAreaBounds: () =>
                  signalAreaBounds?.[activeSignalArea] ??
                  signalAreaBounds?.[activeSignalArea?.toLowerCase?.()] ??
                  null,
                getSdrSettingsLabel: () =>
                  buildSnapshotSettingsLabel({
                    effectiveSdrSettings,
                    gain,
                    ppm,
                    hackrfLnaGain,
                    hackrfVgaGain,
                    hackrfAmpEnabled,
                    hackrfBasebandBandwidth:
                      hackrfBasebandBandwidth ?? undefined,
                    deviceKind:
                      selectedSourceDeviceProfileKind ??
                      deviceProfileKind ??
                      deviceKind ??
                      undefined,
                  }),
                getSourceName: () =>
                  selectedSourceDeviceName ??
                  deviceName ??
                  (isConnected ? "SDR" : "Offline"),
              },
            )
          }
          onStop={stopFastRecording}
        />
      );
    },
    [
      fftCanvasRef,
      fftSnapshotLoading,
      isRecording,
      recordingCountdown,
      supportedVideoFormat,
      takeFastSnapshot,
      startFastRecording,
      stopFastRecording,
      getCanvases,
      fastSnapshotShowStats,
      fastSnapshotShowGeolocation,
      fastSnapshotGeolocation,
      fastSnapshotLocationLabel,
      fastSnapshotMode,
      fastSnapshotGeoUnavailable,
      handleShowStatsChange,
      cycleFastSnapshotMode,
      activeSignalArea,
      gain,
      ppm,
      hackrfLnaGain,
      hackrfVgaGain,
      hackrfAmpEnabled,
      hackrfBasebandBandwidth,
      fftSize,
      activeSignalAreaBounds,
      signalAreaBounds,
      effectiveSdrSettings,
      selectedSourceDeviceProfileKind,
      selectedSourceDeviceName,
      deviceProfileKind,
      deviceKind,
      deviceName,
      isConnected,
    ],
  );

  const fastSpectrumSnapshotAction = useMemo<React.ReactNode>(
    () => buildFastSnapshotControl("spectrum"),
    [buildFastSnapshotControl],
  );

  const fastWaterfallSnapshotAction = useMemo<React.ReactNode>(
    () => buildFastSnapshotControl("waterfall"),
    [buildFastSnapshotControl],
  );

  return { fastSpectrumSnapshotAction, fastWaterfallSnapshotAction };
};

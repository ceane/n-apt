import React, { useCallback, useRef, useState } from "react";
import { FastSnapshotControl } from "@n-apt/app/routes/pages/spectrum/SpectrumRouteControls";
import { getSettingsDefaults } from "@n-apt/settings/public/settingsDefaults";
import {
  useSnapshot,
  type FastCanvases,
} from "@n-apt/capture/hooks/useSnapshot";
import type { SnapshotData } from "@n-apt/spectrum/public/FFTCanvas";
import type { DemodNodeDataPatch } from "@n-apt/demodulation/react-flow/nodes/usePersistDemodNodeData";

interface FrequencyRange {
  min: number;
  max: number;
}

interface NodeFastSnapshotOptions {
  frequencyRange: FrequencyRange;
  dbMin: number;
  dbMax: number;
  powerScale?: "dB" | "dBm";
  waterfallScaleUnit: string;
  spectrogramType: string;
  filenamePrefix: string;
  sourceName: string;
  fftSize: number;
  isDeviceConnected: boolean;
  fastSnapshotShowStats?: boolean;
  persistNodeData: (patch: DemodNodeDataPatch) => void;
  waterfallCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  waterfallOverlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const FAST_WATERFALL_FALLBACK_HEIGHT = 300;

/** Share the spectrum route's fast still/video capture controls with analysis nodes. */
export const useNodeFastSnapshot = (options: NodeFastSnapshotOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [showStats, setShowStats] = useState(
    () =>
      options.fastSnapshotShowStats ??
      getSettingsDefaults().snapshot.fastSnapshotShowStats,
  );
  const {
    isRecording,
    recordingCountdown,
    supportedVideoFormat,
    startFastRecording,
    stopFastRecording,
    takeFastSnapshot,
  } = useSnapshot(options.frequencyRange, options.isDeviceConnected);

  const getSnapshotData = useCallback((): SnapshotData => {
    const current = optionsRef.current;
    const centerFrequencyHz =
      (current.frequencyRange.min + current.frequencyRange.max) / 2;
    return {
      waveform: null,
      fullChannelWaveform: null,
      frequencyRange: current.frequencyRange,
      dbMin: current.dbMin,
      dbMax: current.dbMax,
      powerScale: current.powerScale,
      fftSize: current.fftSize,
      centerFrequencyHz,
      isDeviceConnected: current.isDeviceConnected,
      vizZoom: 1,
      vizPanOffset: 0,
      waterfallTextureSnapshot: null,
      waterfallTextureMeta: null,
      waterfallBuffer: null,
      waterfallDims: null,
      webgpuEnabled: false,
      colormap: [],
    };
  }, []);

  const getCanvases = useCallback(
    (): FastCanvases => ({
      spectrumGpu: null,
      spectrumOverlay: null,
      waterfallGpu: optionsRef.current.waterfallCanvasRef.current,
      waterfallOverlay: optionsRef.current.waterfallOverlayCanvasRef.current,
    }),
    [],
  );

  const getCanvasDimensions = useCallback(() => {
    const canvas = optionsRef.current.waterfallCanvasRef.current;
    return {
      width: Math.max(1, canvas?.width ?? 1),
      height: Math.max(1, canvas?.height ?? FAST_WATERFALL_FALLBACK_HEIGHT),
    };
  }, []);

  const handleShowStatsChange = useCallback((show: boolean) => {
    setShowStats(show);
    optionsRef.current.persistNodeData({ fastSnapshotShowStats: show });
  }, []);

  const takeImage = useCallback(() => {
    const current = optionsRef.current;
    const { width, height } = getCanvasDimensions();
    void takeFastSnapshot(
      "waterfall",
      getSnapshotData,
      width,
      height,
      getCanvases,
      {
        showStats,
        sourceName: current.sourceName,
        fftSize: current.fftSize,
        spectrogramType: current.spectrogramType,
        waterfallScaleUnit: current.waterfallScaleUnit,
        preserveWaterfallEdges: true,
        waterfallPlotInsets: { left: 0, right: 0 },
        filenamePrefix: `fast-${current.filenamePrefix}-snapshot`,
      },
    );
  }, [
    getCanvases,
    getCanvasDimensions,
    getSnapshotData,
    showStats,
    takeFastSnapshot,
  ]);

  const startVideo = useCallback(() => {
    const current = optionsRef.current;
    startFastRecording(
      "waterfall",
      getSnapshotData,
      getCanvasDimensions,
      `fast-${current.filenamePrefix}-recording`,
      getCanvases,
      {
        showStats,
        sourceName: current.sourceName,
        fftSize: current.fftSize,
        spectrogramType: current.spectrogramType,
        waterfallScaleUnit: current.waterfallScaleUnit,
        preserveWaterfallEdges: true,
        waterfallPlotInsets: { left: 0, right: 0 },
        getSpectrogramType: () => optionsRef.current.spectrogramType,
        getWaterfallScaleUnit: () => optionsRef.current.waterfallScaleUnit,
      },
    );
  }, [
    getCanvases,
    getCanvasDimensions,
    getSnapshotData,
    showStats,
    startFastRecording,
  ]);

  const snapshotControl = (
    <FastSnapshotControl
      isRecording={isRecording === "waterfall"}
      recordingCountdown={recordingCountdown}
      videoFormat={supportedVideoFormat}
      showStats={showStats}
      onShowStatsChange={handleShowStatsChange}
      onImage={takeImage}
      onVideo={startVideo}
      onStop={stopFastRecording}
    />
  );

  return { snapshotControl, isRecording: isRecording === "waterfall" };
};

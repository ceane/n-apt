import React, { useEffect, useRef, useMemo, forwardRef, useCallback } from "react";
import styled from "styled-components";
import { FFTAndWaterfall } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components/FFTCanvas";
import { useStitchingLogic } from "@n-apt/hooks/useStitchingLogic";
import { usePlaybackAnimation } from "@n-apt/hooks/usePlaybackAnimation";
import { useChannelManagement } from "@n-apt/hooks/useChannelManagement";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useAppDispatch } from "@n-apt/redux";
import {
  setActivePlaybackMetadata,
  setPlaybackChannels,
  clearActivePlaybackMetadata,
  incrementPlaybackFrameCounter,
} from "@n-apt/redux";
import type { FFTVisualizerMachine } from "@n-apt/utils/fftVisualizerMachine";
import { buildPlaybackSeedFrame } from "@n-apt/utils/playbackSeedFrame";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

interface FFTPlaybackCanvasProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  stitchTrigger: number | null;
  stitchSourceSettings: { gain: number; ppm: number };
  isPaused: boolean;
  onStitchStatus?: (status: string) => void;
  snapshotGridPreference?: boolean;
  fftSize: number;
  vizZoom?: number;
  vizPanOffset?: number;
  onVizZoomChange?: (zoom: number) => void;
  onVizPanChange?: (pan: number) => void;
  fftMin?: number;
  fftMax?: number;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  displayMode: "fft" | "iq";
  powerScale?: "dB" | "dBm";
  visualizerMachine?: FFTVisualizerMachine;
}

const StitcherContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: ${(props) => props.theme.background};
  position: relative;
`;

const VisualizationContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
`;

const EmptyContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.colors?.textSecondary ?? "#666"};
  font-size: 14px;
  text-align: center;
  padding: 40px;
`;

const FileCountText = styled.div`
  margin-bottom: 16px;
`;

const HelpText = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.colors?.textTertiary ?? "#666"};
`;

// Extracted memoized ChannelSelector component
interface ChannelSelectorProps {
  channelCount: number;
  activeChannel: number;
  channelLabel?: string;
  onChannelChange: (newIdx: number) => void;
}

const ChannelSelector = React.memo<ChannelSelectorProps>(({
  channelCount,
  activeChannel,
  channelLabel,
  onChannelChange
}) => {
  if (channelCount <= 1) return null;
  const displayLabel = channelLabel || `Channel ${activeChannel + 1}`;

  return (
    <div style={{
      position: "absolute",
      top: "4px",
      right: "105px",
      transform: "none",
      backgroundColor: "var(--color-surface, rgb(41 41 41 / 80%))",
      padding: "8px 12px",
      borderRadius: "20px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      color: "var(--color-text-primary, #fff)",
      fontFamily: "JetBrains Mono",
      fontSize: "12px",
      border: "1px solid var(--color-border)",
      zIndex: 10,
      userSelect: "none"
    }}>
      <span
        style={{ cursor: "pointer", opacity: activeChannel > 0 ? 1 : 0.3 }}
        onClick={() => activeChannel > 0 && onChannelChange(activeChannel - 1)}
      >
        &lt;
      </span>
      <span>{displayLabel} / {channelCount}</span>
      <span
        style={{ cursor: "pointer", opacity: activeChannel < channelCount - 1 ? 1 : 0.3 }}
        onClick={() => activeChannel < channelCount - 1 && onChannelChange(activeChannel + 1)}
      >
        &gt;
      </span>
    </div>
  );
});

ChannelSelector.displayName = 'ChannelSelector';

const FFTPlaybackCanvas = forwardRef<FFTCanvasHandle, FFTPlaybackCanvasProps>(({
  selectedFiles,
  stitchTrigger,
  stitchSourceSettings,
  isPaused,
  onStitchStatus,
  snapshotGridPreference,
  fftSize,
  vizZoom,
  vizPanOffset,
  onVizZoomChange,
  onVizPanChange,
  fftMin,
  fftMax,
  onFftDbLimitsChange,
  displayMode,
  powerScale,
  visualizerMachine,
}, forwardedRef) => {
  const dispatch = useAppDispatch();
  const { state: spectrumState, dispatch: storeDispatch } = useSpectrumStore();
  const { activeSignalArea } = spectrumState;
  // ── Custom hooks for separated concerns ──
  const {
    hasStitchedData,
    frequencyRange,
    channelCount,
    activeChannel,
    hardwareSampleRateHz,
    allChannelsRef,
    workerFileDataCache,
    workerFreqMap,
    workerMetadataMap,
    precomputedFrames,
    setChannelCount,
    setActiveChannel,
    setFrequencyRange,
  } = useStitchingLogic({
    selectedFiles,
    stitchTrigger,
    stitchSourceSettings,
    fftSize,
    onStitchStatus,
    onChannelsChange: (channels) => {
      // Strip non-serializable binary data for Redux
      const metadataOnly = channels.map(ch => ({
        label: ch.label || `Channel ${channels.indexOf(ch) + 1}`,
        center_freq_hz: ch.center_freq_hz,
        sample_rate_hz: ch.sample_rate_hz,
        frequency_range: ch.frequency_range,
        id: ch.id
      }));
      dispatch(setPlaybackChannels(metadataOnly));
    },
  });

  // Refs for data that changes rapidly (no re-render cascades)
  const fileDataCache = useRef<Map<string, number[]>>(new Map());
  const freqMapRef = useRef<Map<string, number>>(new Map());
  const selectedFilesRef = useRef(selectedFiles);
  selectedFilesRef.current = selectedFiles;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const stitchSourceSettingsRef = useRef(stitchSourceSettings);
  stitchSourceSettingsRef.current = stitchSourceSettings;

  /**
   * Hot-path data ref — written directly by the animation loop, never via
   * React state.  FFTCanvas reads this ref on every rAF, identical to the
   * live-view data path in useWebSocket → dataRef.current.
   */
  const fftCanvasDataRef = useRef<LiveFrameData | null>(null);

  // ── Memoized callbacks for hook stability ──
  const handleFrameEmitted = useCallback(() => {
    dispatch(incrementPlaybackFrameCounter());
  }, [dispatch]);

  const handleChannelMetadataChange = useCallback(
    (meta: any) => {
      dispatch(setActivePlaybackMetadata(meta));
    },
    [dispatch],
  );

  // ── Playback animation hook ──
  const { animateFrame } = usePlaybackAnimation({
    hasStitchedData,
    isPaused,
    activeChannel,
    allChannelsRef,
    precomputedFrames,
    fftCanvasDataRef,
    displayMode,
    onFrameEmitted: handleFrameEmitted,
  });

  // ── Channel management hook ──
  const { switchChannel } = useChannelManagement({
    allChannelsRef,
    setActiveChannel,
    setFrequencyRange,
    onChannelMetadataChange: handleChannelMetadataChange,
  });

  // Single effect to populate metadata - runs on mount and when relevant state changes
  // Handles both channel switching and file -> live -> file navigation
  useEffect(() => {
    // Guard: only populate if we have stitched data and channels
    if (!hasStitchedData || channelCount === 0) return;

    const ch = allChannelsRef.current[activeChannel];
    if (!ch) return;

    const activeRange =
      Array.isArray(ch.frequency_range) &&
        ch.frequency_range.length === 2 &&
        Number.isFinite(ch.frequency_range[0]) &&
        Number.isFinite(ch.frequency_range[1])
        ? ch.frequency_range
        : undefined;

    const channelLabel = ch.label || `Channel ${activeChannel + 1}`;

    console.log("[FFTPlaybackCanvas] Updating metadata", {
      activeChannel,
      channelCount,
      chLabel: channelLabel,
      chSampleRate: ch.sample_rate_hz,
      chCenter: ch.center_freq_hz,
      hasStitchedData
    });
    dispatch(setActivePlaybackMetadata({
      activeChannel,
      channelCount,
      channelLabel,
      center_frequency_hz: activeRange
        ? ((activeRange[0] + activeRange[1]) / 2) * 1_000_000
        : ch.center_freq_hz,
      capture_sample_rate_hz: activeRange
        ? (activeRange[1] - activeRange[0]) * 1_000_000
        : ch.sample_rate_hz,
      frame_rate: ch.frame_rate,
      hardware_sample_rate_hz: ch.hardware_sample_rate_hz ?? hardwareSampleRateHz,
      frequency_range: activeRange,
    }));
  }, [hasStitchedData, activeChannel, channelCount, hardwareSampleRateHz, dispatch]);

  // Sync activeSignalArea (from sidebar) to activeChannel (index)
  useEffect(() => {
    if (!activeSignalArea || allChannelsRef.current.length === 0) return;

    // Find index by label
    const idx = allChannelsRef.current.findIndex(ch => {
      const label = ch.label || `Channel ${allChannelsRef.current.indexOf(ch) + 1}`;
      return label === activeSignalArea;
    });

    if (idx !== -1 && idx !== activeChannel) {
      switchChannel(idx);
    }
  }, [activeSignalArea, activeChannel, switchChannel, allChannelsRef]);

  // Set initial active area in store when data loads
  useEffect(() => {
    if (hasStitchedData && !activeSignalArea && allChannelsRef.current.length > 0) {
      const firstLabel = allChannelsRef.current[0].label || "Channel 1";
      storeDispatch({ type: "SET_SIGNAL_AREA", area: firstLabel });
    }
  }, [hasStitchedData, activeSignalArea, allChannelsRef, storeDispatch]);

  // ── Clear when file selection actually changes ──
  const fileNamesSet = useMemo(() =>
    new Set(selectedFiles.map(f => f.name)),
    [selectedFiles]
  );
  const visualizerSessionKey = useMemo(() => {
    const fileIdentity = selectedFiles
      .map((file) => file.id || file.name)
      .sort()
      .join("|");
    return `playback:${displayMode}:${stitchTrigger ?? 0}:${fileIdentity}`;
  }, [displayMode, selectedFiles, stitchTrigger]);

  const initialFileNamesKey = useMemo(
    () => Array.from(fileNamesSet).sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const prevFileNamesRef2 = useRef(initialFileNamesKey);

  useEffect(() => {
    const nameKey = Array.from(fileNamesSet).sort().join("|");
    if (nameKey === prevFileNamesRef2.current) return;
    prevFileNamesRef2.current = nameKey;

    fftCanvasDataRef.current = null;
    setChannelCount(0);
    setActiveChannel(0);
    dispatch(clearActivePlaybackMetadata());
    fileDataCache.current.clear();
    freqMapRef.current.clear();
    allChannelsRef.current = [];
  }, [fileNamesSet, setChannelCount, setActiveChannel, dispatch, allChannelsRef]);

  // ── Handle stitched data state changes ──
  useEffect(() => {
    if (!hasStitchedData) {
      return;
    }

    const channelData = allChannelsRef.current[activeChannel] ?? allChannelsRef.current[0];
    fftCanvasDataRef.current = buildPlaybackSeedFrame({
      displayMode,
      precomputedFrames: precomputedFrames.current,
      channelData,
    });

    // If paused, manually trigger one frame update to reflect channel/mode changes
    if (isPaused) {
      animateFrame(performance.now(), true);
    }
  }, [
    activeChannel,
    allChannelsRef,
    displayMode,
    hasStitchedData,
    precomputedFrames,
    isPaused,
    animateFrame,
  ]);

  useEffect(() => {
    return () => {
      workerFileDataCache.current = [];
      workerFreqMap.current = [];
      workerMetadataMap.current = [];
      precomputedFrames.current = [];
      fileDataCache.current.clear();
      freqMapRef.current.clear();
      allChannelsRef.current = [];
      dispatch(clearActivePlaybackMetadata());
    };
  }, [dispatch]);

  return (
    <StitcherContainer>
      {hasStitchedData ? (
        <VisualizationContainer>
          <FFTAndWaterfall
            ref={forwardedRef}
            dataRef={fftCanvasDataRef}
            frequencyRange={frequencyRange}
            centerFrequencyMHz={(frequencyRange.min + frequencyRange.max) / 2}
            activeSignalArea="Stitched"
            isPaused={isPaused}
            snapshotGridPreference={snapshotGridPreference ?? true}
            vizZoom={vizZoom}
            vizPanOffset={vizPanOffset}
            onVizZoomChange={onVizZoomChange}
            onVizPanChange={onVizPanChange}
            fftMin={fftMin}
            fftMax={fftMax}
            onFftDbLimitsChange={onFftDbLimitsChange}
            hardwareSampleRateHz={hardwareSampleRateHz}
            isIqRecordingActive={true}
            fftFrameRate={allChannelsRef.current[activeChannel]?.frame_rate}
            powerScale={powerScale}
            visualizerMachine={visualizerMachine}
            visualizerSessionKey={visualizerSessionKey}
          />
          <ChannelSelector
            channelCount={channelCount}
            activeChannel={activeChannel}
            channelLabel={allChannelsRef.current[activeChannel]?.label || `Channel ${activeChannel + 1}`}
            onChannelChange={switchChannel}
          />
        </VisualizationContainer>
      ) : (
        <EmptyContainer>
          <FileCountText>
            {selectedFiles.length === 0
              ? "No files selected"
              : `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected`}
          </FileCountText>
          <HelpText>
            {selectedFiles.length > 0
              ? "Click Stitch/Process to visualize"
              : "Drop .wav or .napt files here"}
          </HelpText>
        </EmptyContainer>
      )}
    </StitcherContainer>
  );
});

export default FFTPlaybackCanvas;

import React, { useEffect, useLayoutEffect, useRef, useMemo, forwardRef } from "react";
import styled from "styled-components";
import { FFTCanvas } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components/FFTCanvas";
import { useStitchingLogic } from "@n-apt/hooks/useStitchingLogic";
import { usePlaybackAnimation } from "@n-apt/hooks/usePlaybackAnimation";
import { useChannelManagement } from "@n-apt/hooks/useChannelManagement";
import { useAppDispatch } from "@n-apt/redux";
import { setActivePlaybackMetadata, clearActivePlaybackMetadata } from "@n-apt/redux";

interface FFTPlaybackCanvasProps {
  selectedFiles: { name: string; file: File }[];
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
}

const StitcherContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0a0a0a;
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
  color: #444;
  font-size: 14px;
  text-align: center;
  padding: 40px;
`;

const FileCountText = styled.div`
  margin-bottom: 16px;
`;

const HelpText = styled.div`
  font-size: 12px;
  color: #666;
`;

// Extracted memoized ChannelSelector component
interface ChannelSelectorProps {
  channelCount: number;
  activeChannel: number;
  onChannelChange: (newIdx: number) => void;
}

const ChannelSelector = React.memo<ChannelSelectorProps>(({
  channelCount,
  activeChannel,
  onChannelChange
}) => {
  if (channelCount <= 1) return null;

  return (
    <div style={{
      position: "absolute",
      top: "4px",
      right: "105px",
      transform: "none",
      backgroundColor: "rgb(41 41 41 / 80%)",
      padding: "8px 12px",
      borderRadius: "20px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      color: "#fff",
      fontFamily: "JetBrains Mono",
      fontSize: "12px",
      border: "1px solid #333",
      zIndex: 10,
      userSelect: "none"
    }}>
      <span
        style={{ cursor: "pointer", opacity: activeChannel > 0 ? 1 : 0.3 }}
        onClick={() => activeChannel > 0 && onChannelChange(activeChannel - 1)}
      >
        &lt;
      </span>
      <span>Channel {activeChannel + 1} / {channelCount}</span>
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
}, forwardedRef) => {
  const dispatch = useAppDispatch();
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
  const prevFileNamesRef = useRef<string>("");

  /**
   * Hot-path data ref — written directly by the animation loop, never via
   * React state.  FFTCanvas reads this ref on every rAF, identical to the
   * live-view data path in useWebSocket → dataRef.current.
   */
  const fftCanvasDataRef = useRef<any>(null);

  // ── Playback animation hook ──
  usePlaybackAnimation({
    hasStitchedData,
    isPaused,
    activeChannel,
    allChannelsRef,
    precomputedFrames,
    fftCanvasDataRef,
  });

  // ── Channel management hook ──
  const { switchChannel } = useChannelManagement({
    allChannelsRef,
    setActiveChannel,
    setFrequencyRange,
    onChannelMetadataChange: (meta) => {
      dispatch(setActivePlaybackMetadata(meta));
    },
  });

  useLayoutEffect(() => {
    const ch = allChannelsRef.current[activeChannel];
    if (!ch) return;
    const activeRange =
      Array.isArray(ch.frequency_range) &&
        ch.frequency_range.length === 2 &&
        Number.isFinite(ch.frequency_range[0]) &&
        Number.isFinite(ch.frequency_range[1])
        ? ch.frequency_range
        : undefined;
    dispatch(setActivePlaybackMetadata({
      activeChannel,
      channelCount,
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
  }, [activeChannel, channelCount, hardwareSampleRateHz, allChannelsRef, dispatch]);

  // ── Clear when file selection actually changes ──
  const fileNamesSet = useMemo(() =>
    new Set(selectedFiles.map(f => f.name)),
    [selectedFiles]
  );

  useEffect(() => {
    const nameKey = Array.from(fileNamesSet).sort().join("|");
    if (nameKey === prevFileNamesRef.current) return;
    prevFileNamesRef.current = nameKey;

    fftCanvasDataRef.current = null;
    setChannelCount(0);
    setActiveChannel(0);
    dispatch(clearActivePlaybackMetadata());
    fileDataCache.current.clear();
    freqMapRef.current.clear();
    allChannelsRef.current = [];
  }, [fileNamesSet, setChannelCount, setActiveChannel, dispatch]);

  // ── Cleanup worker data on unmount ──
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
          <FFTCanvas
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
          />
          <ChannelSelector
            channelCount={channelCount}
            activeChannel={activeChannel}
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

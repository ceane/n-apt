import React, {
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useCallback,
  useState,
  memo,
  type ReactNode,
} from "react";
import styled from "styled-components";
import { FFTAndWaterfall } from "@n-apt/spectrum";
import type { FFTCanvasHandle } from "@n-apt/spectrum/FFTCanvas";
import { Button } from "@n-apt/ui/Button";
import { useSnapshot } from "@n-apt/capture/public/useSnapshot";
import { useStitchingLogic } from "@n-apt/spectrum/hooks/useStitchingLogic";
import { usePlaybackAnimation } from "@n-apt/capture/public/usePlaybackAnimation";
import { useChannelManagement } from "@n-apt/spectrum/hooks/useChannelManagement";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { selectActiveSignalArea } from "@n-apt/redux/selectors/performanceSelectors";
import {
  bumpSnapshotSectionPulse,
  setActivePlaybackMetadata,
  setPlaybackChannels,
  clearActivePlaybackMetadata,
  setActiveSignalArea,
  setSelectedFiles,
  triggerStitch,
} from "@n-apt/redux";
import type { FFTVisualizerMachine } from "@n-apt/app/infrastructure/visualization/fftVisualizerMachine";
import { buildPlaybackSeedFrame } from "@n-apt/app/infrastructure/io/playbackSeedFrame";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import type { LiveCanvasStatusRow } from "@n-apt/spectrum/hooks/useDraw2DFFTSignal";
import { formatFrequency } from "@n-apt/math/frequency";
import { formatDuration } from "@n-apt/math/formatters";
import { fileFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { shouldRestorePausedFrameSnapshot } from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import { fileRegistry } from "@n-apt/app/infrastructure/io/fileRegistry";
import { DecryptionFallback } from "@n-apt/ui/DecryptionFallback";

interface FFTPlaybackCanvasProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  stitchTrigger: number | null;
  stitchSourceSettings: { gain: number; ppm: number };
  isPaused: boolean;
  onStitchStatus?: (status: string) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
  snapshotGridPreference?: boolean;
  fftSize: number;
  displayTemporalResolution?: TemporalResolution;
  vizZoom?: number;
  vizZoomFloor?: number;
  vizZoomFloorPan?: number;
  vizPanOffset?: number;
  autoZoomStability?: boolean;
  onVizZoomChange?: (zoom: number) => void;
  onVizZoomFloorChange?: (zoomFloor: number) => void;
  onVizZoomFloorPanChange?: (pan: number) => void;
  onVizPanChange?: (pan: number) => void;
  fftMin?: number;
  fftMax?: number;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  displayMode: "fft" | "iq";
  powerScale?: "dB" | "dBm";
  removeDcSpike?: boolean;
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

const FastSnapshotButton = styled(Button)`
  height: 24px;
  min-height: 24px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.02em;
  box-shadow: none;

  &:disabled {
    opacity: 0.55;
    color: ${(props) => props.theme.textMuted};
    background-color: ${(props) => props.theme.surface};
    border-color: ${(props) => props.theme.border};
    box-shadow: none;
    transform: none;
  }
`;

// Extracted memoized ChannelSelector component
interface ChannelSelectorProps {
  channelCount: number;
  activeChannel: number;
  channelLabel?: string;
  onChannelChange: (newIdx: number) => void;
}

const ChannelSelector = React.memo<ChannelSelectorProps>(
  ({ channelCount, activeChannel, channelLabel, onChannelChange }) => {
    if (channelCount <= 1) return null;
    const displayLabel = channelLabel || `Channel ${activeChannel + 1}`;

    return (
      <div
        style={{
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
          userSelect: "none",
        }}
      >
        <span
          style={{ cursor: "pointer", opacity: activeChannel > 0 ? 1 : 0.3 }}
          onClick={() =>
            activeChannel > 0 && onChannelChange(activeChannel - 1)
          }
        >
          &lt;
        </span>
        <span>
          {displayLabel} / {channelCount}
        </span>
        <span
          style={{
            cursor: "pointer",
            opacity: activeChannel < channelCount - 1 ? 1 : 0.3,
          }}
          onClick={() =>
            activeChannel < channelCount - 1 &&
            onChannelChange(activeChannel + 1)
          }
        >
          &gt;
        </span>
      </div>
    );
  },
);

ChannelSelector.displayName = "ChannelSelector";

const FFTPlaybackCanvas = forwardRef<FFTCanvasHandle, FFTPlaybackCanvasProps>(
  (
    {
      selectedFiles,
      stitchTrigger,
      stitchSourceSettings,
      isPaused,
      onStitchStatus,
      snapshotGridPreference,
      fftSize,
      displayTemporalResolution,
      vizZoom,
      vizZoomFloor,
      vizZoomFloorPan,
      vizPanOffset,
      autoZoomStability,
      onVizZoomChange,
      onVizZoomFloorChange,
      onVizZoomFloorPanChange,
      onVizPanChange,
      fftMin,
      fftMax,
      onFftDbLimitsChange,
      displayMode,
      powerScale,
      removeDcSpike,
      visualizerMachine,
    },
    forwardedRef,
  ) => {
    const dispatch = useAppDispatch();

    const handleCanvasDrop = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          [".napt", ".iq", ".wav"].some((extension) =>
            file.name.toLowerCase().endsWith(extension),
          ),
        );
        if (files.length > 0) {
          dispatch(
            setSelectedFiles(
              files.map((file) => ({
                id: fileRegistry.register(file),
                name: file.name,
              })),
            ),
          );
          dispatch(triggerStitch());
        }
      },
      [dispatch],
    );

    useEffect(() => {
      // Keep dropped local files from becoming browser navigations when the
      // drop lands on the visualization instead of the sidebar picker.
      const preventExternalFileNavigation = (event: DragEvent) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
        }
      };
      window.addEventListener("dragover", preventExternalFileNavigation);
      window.addEventListener("drop", preventExternalFileNavigation);
      return () => {
        window.removeEventListener("dragover", preventExternalFileNavigation);
        window.removeEventListener("drop", preventExternalFileNavigation);
      };
    }, []);

    const stitchStatus = useAppSelector(
      (state) => state.waterfall.stitchStatus,
    );
    const { toggleVisualizerPause } = useSpectrumStore();
    const activeSignalArea = useAppSelector(selectActiveSignalArea);
    const [snapshotButtonsLoading, setSnapshotButtonsLoading] = useState(false);
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;
    const animateFrameRef = useRef<
      ((timestamp: number, forceFrame?: boolean) => void) | null
    >(null);
    // Bumped whenever stitching (re)writes allChannelsRef / workerMetadataMap.
    // The refs have stable identity, so render-time reads of them must be
    // paired with this counter to guarantee recomputation.
    const [channelDataVersion, setChannelDataVersion] = useState(0);
    // ── Custom hooks for separated concerns ──
    const {
      hasStitchedData,
      frequencyRange,
      channelCount,
      activeChannel,
      hardwareSampleRateHz,
      allChannelsRef,
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
        setChannelDataVersion((version) => version + 1);
        // Strip non-serializable binary data for Redux
        const metadataOnly = channels.map((ch) => ({
          label: ch.label || `Channel ${channels.indexOf(ch) + 1}`,
          center_freq_hz: ch.center_freq_hz,
          sample_rate_hz: ch.sample_rate_hz,
          frequency_range: ch.frequency_range,
          id: ch.id,
        }));
        dispatch(setPlaybackChannels(metadataOnly));
      },
      onProcessedDataChange: (processed) => {
        if (processed && isPausedRef.current) {
          animateFrameRef.current?.(performance.now(), true);
          if (forwardedRef && "current" in forwardedRef) {
            forwardedRef.current?.triggerSnapshotRender();
          }
        }
      },
    });

    const { handleSnapshot: takeSnapshot } = useSnapshot(
      frequencyRange ?? null,
      true,
    );

    /**
     * Hot-path data ref — written directly by the animation loop, never via
     * React state.  FFTCanvas reads this ref on every rAF, identical to the
     * live-view data path in the WebSocket runtime → dataRef.current.
     */
    const fftCanvasDataRef = fileFrameRuntime.ref;
    const seededPlaybackKeyRef = useRef<string | null>(null);

    // Seed the ref during the render that mounts FFTAndWaterfall. Writing the
    // first frame only from an effect creates a race: the child can start its
    // canvas loop while dataRef is still null and remain behind the loading
    // placeholder until another playback tick arrives.
    const playbackSeedKey = useMemo(
      () =>
        `${selectedFiles
          .map((file) => file.id || file.name)
          .sort()
          .join("|")}:${stitchTrigger ?? "none"}:${displayMode}:${activeChannel}`,
      [selectedFiles, stitchTrigger, displayMode, activeChannel],
    );
    if (!hasStitchedData) {
      fftCanvasDataRef.current = null;
      seededPlaybackKeyRef.current = null;
    } else if (seededPlaybackKeyRef.current !== playbackSeedKey) {
      const channelData =
        allChannelsRef.current[activeChannel] ?? allChannelsRef.current[0];
      fftCanvasDataRef.current = buildPlaybackSeedFrame({
        displayMode,
        precomputedFrames: precomputedFrames.current,
        channelData,
        fftSize,
      });
      seededPlaybackKeyRef.current = playbackSeedKey;
    }

    useEffect(() => {
      if (!hasStitchedData) return;
      const renderId = window.setTimeout(() => {
        if (forwardedRef && "current" in forwardedRef) {
          forwardedRef.current?.triggerSnapshotRender();
        }
      }, 0);
      return () => window.clearTimeout(renderId);
    }, [forwardedRef, hasStitchedData, playbackSeedKey]);

    // ── Memoized callbacks for hook stability ──
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
      fftSize,
      allChannelsRef,
      precomputedFrames,
      fftCanvasDataRef,
      displayMode,
    });
    animateFrameRef.current = animateFrame;

    useEffect(() => {
      return () => {
        fileFrameRuntime.clear();
      };
    }, []);

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

      dispatch(
        setActivePlaybackMetadata({
          activeChannel,
          channelCount,
          channelLabel,
          center_frequency_hz: activeRange
            ? (activeRange[0] + activeRange[1]) / 2
            : ch.center_freq_hz,
          capture_sample_rate_hz: activeRange
            ? activeRange[1] - activeRange[0]
            : ch.sample_rate_hz,
          frame_rate: ch.frame_rate,
          hardware_sample_rate_hz:
            ch.hardware_sample_rate_hz ?? hardwareSampleRateHz,
          frequency_range: activeRange,
        }),
      );

      // Ensure sidebar's selector matches our restored/paged state
      dispatch(setActiveSignalArea(channelLabel));
    }, [
      hasStitchedData,
      activeChannel,
      channelCount,
      channelDataVersion,
      hardwareSampleRateHz,
      dispatch,
    ]);

    // Sync activeSignalArea (from sidebar) to activeChannel (index)
    useEffect(() => {
      if (!activeSignalArea || allChannelsRef.current.length === 0) return;

      // Find index by label
      const idx = allChannelsRef.current.findIndex((ch) => {
        const label =
          ch.label || `Channel ${allChannelsRef.current.indexOf(ch) + 1}`;
        return label === activeSignalArea;
      });

      if (idx !== -1 && idx !== activeChannel) {
        switchChannel(idx);
      }
    }, [activeSignalArea, activeChannel, switchChannel, allChannelsRef]);

    // Set initial active area in store when data loads
    useEffect(() => {
      if (
        hasStitchedData &&
        !activeSignalArea &&
        allChannelsRef.current.length > 0
      ) {
        const firstLabel = allChannelsRef.current[0].label || "Channel 1";
        dispatch(setActiveSignalArea(firstLabel));
      }
    }, [hasStitchedData, activeSignalArea, allChannelsRef, dispatch]);

    // ── Clear when file selection actually changes ──
    // Null-initialized so the first run after mount never clears state that
    // useStitchingLogic has just populated.
    const prevFileNamesKeyRef = useRef<string | null>(null);

    useEffect(() => {
      const nameKey = selectedFiles
        .map((file) => file.id || file.name)
        .sort()
        .join("|");
      if (prevFileNamesKeyRef.current === null) {
        prevFileNamesKeyRef.current = nameKey;
        return;
      }
      if (nameKey === prevFileNamesKeyRef.current) return;
      prevFileNamesKeyRef.current = nameKey;

      fftCanvasDataRef.current = null;
      fileFrameRuntime.clear();
      setChannelCount(0);
      setActiveChannel(0);
      dispatch(clearActivePlaybackMetadata());
      allChannelsRef.current = [];
    }, [
      selectedFiles,
      setChannelCount,
      setActiveChannel,
      dispatch,
      allChannelsRef,
    ]);
    const visualizerSessionKey = useMemo(
      () =>
        `playback:${displayMode}:${stitchTrigger ?? 0}:${selectedFiles
          .map((file) => file.id || file.name)
          .sort()
          .join("|")}`,
      [displayMode, selectedFiles, stitchTrigger],
    );

    const pulseSnapshotSection = useCallback(() => {
      dispatch(bumpSnapshotSectionPulse());
    }, [dispatch]);

    const renderFastSnapshotButton = useCallback(
      ({
        filenamePrefix,
        getCanvas,
      }: {
        filenamePrefix: string;
        getCanvas: () => HTMLCanvasElement | null;
      }) => (
        <FastSnapshotButton
          type="button"
          $variant="accentSoft"
          disabled={snapshotButtonsLoading}
          onClick={() => {
            pulseSnapshotSection();
            void takeSnapshot({
              whole: false,
              showWaterfall: false,
              showStats: false,
              showGeolocation: false,
              showGrid: false,
              format: "png",
              useThemeColors: false,
              getSnapshotData: () =>
                forwardedRef && "current" in forwardedRef
                  ? (forwardedRef.current?.getSnapshotData() ?? null)
                  : null,
              canvasOnly: { getCanvas, filenamePrefix },
            });
          }}
        >
          Fast Snapshot
        </FastSnapshotButton>
      ),
      [
        forwardedRef,
        pulseSnapshotSection,
        snapshotButtonsLoading,
        takeSnapshot,
      ],
    );

    const getSpectrumCanvas = useCallback(
      () =>
        forwardedRef && "current" in forwardedRef
          ? (forwardedRef.current?.getSpectrumCanvas() ?? null)
          : null,
      [forwardedRef],
    );
    const getWaterfallCanvas = useCallback(
      () =>
        forwardedRef && "current" in forwardedRef
          ? (forwardedRef.current?.getWaterfallCanvas() ?? null)
          : null,
      [forwardedRef],
    );

    const fastSpectrumSnapshotAction = useMemo<ReactNode>(
      () =>
        renderFastSnapshotButton({
          filenamePrefix: "fast-fft-snapshot",
          getCanvas: getSpectrumCanvas,
        }),
      [renderFastSnapshotButton, getSpectrumCanvas],
    );

    const fastWaterfallSnapshotAction = useMemo<ReactNode>(
      () =>
        renderFastSnapshotButton({
          filenamePrefix: "fast-waterfall-snapshot",
          getCanvas: getWaterfallCanvas,
        }),
      [renderFastSnapshotButton, getWaterfallCanvas],
    );

    // Mirror the active channel's display-relevant fields into state so
    // consumers (fftFrameRate, ChannelSelector label) re-render when the
    // stitching refs change, instead of reading them during render.
    const [activeChannelInfo, setActiveChannelInfo] = useState<{
      label?: string;
      frameRate?: number;
    }>({});
    useEffect(() => {
      const ch =
        allChannelsRef.current[activeChannel] ?? allChannelsRef.current[0];
      const label = ch?.label || `Channel ${activeChannel + 1}`;
      const frameRate = ch?.frame_rate;
      setActiveChannelInfo((previous) =>
        previous.label === label && previous.frameRate === frameRate
          ? previous
          : { label, frameRate },
      );
    }, [activeChannel, channelDataVersion, allChannelsRef]);

    const playbackCanvasStatusRow = useMemo<LiveCanvasStatusRow | null>(() => {
      if (!hasStitchedData) return null;

      const channelData =
        allChannelsRef.current[activeChannel] ?? allChannelsRef.current[0];
      const firstMetadata = workerMetadataMap.current[0]?.[1] ?? null;
      const captureSampleRateHz =
        firstMetadata?.capture_sample_rate_hz ??
        channelData?.sample_rate_hz ??
        hardwareSampleRateHz;
      const displayFftSize =
        firstMetadata?.fft_size ?? channelData?.bins_per_frame ?? fftSize;
      const deviceLabel =
        firstMetadata?.source_device ?? firstMetadata?.hardware ?? "File";
      const durationLabel =
        typeof firstMetadata?.duration_s === "number" &&
          Number.isFinite(firstMetadata.duration_s)
          ? formatDuration(firstMetadata.duration_s)
          : "N/A";

      return {
        sampleRateLabel: `Captured Sample Rate: ${formatFrequency(
          captureSampleRateHz ?? 0,
          {
            precisionMHz: 4,
            precisionKHz: 2,
            precisionGHz: 3,
            trimTrailingZeros: true,
          },
        )}`,
        fftSizeLabel: `FFT Size: ${Number(displayFftSize).toLocaleString(
          "en-US",
        )}`,
        fftWindowLabel: `Device: ${deviceLabel}`,
        timingLabel: `Duration: ${durationLabel}`,
      };
    }, [
      activeChannel,
      allChannelsRef,
      fftSize,
      hardwareSampleRateHz,
      hasStitchedData,
      channelDataVersion,
      workerMetadataMap,
    ]);

    // The render-phase seeding above rebuilds the data ref whenever the seed
    // key (files / stitch trigger / display mode / channel) changes. When
    // paused, manually repaint once so channel/mode switches are visible
    // without waiting for the next playback tick.
    useEffect(() => {
      if (!hasStitchedData || !isPaused) return;
      animateFrame(performance.now(), true);
    }, [
      activeChannel,
      displayMode,
      hasStitchedData,
      isPaused,
      animateFrame,
    ]);

    // Global keyboard event listener for spacebar to toggle play/pause
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        // Only handle spacebar when not in an input field
        if (
          event.code === "Space" &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName || "",
          ) &&
          !(document.activeElement as HTMLElement)?.isContentEditable
        ) {
          event.preventDefault();
          event.stopPropagation();
          toggleVisualizerPause();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [toggleVisualizerPause]);

    // Leaving playback mode must drop the shared metadata so the live view
    // doesn't inherit file-mode channel info. The stitching hook owns its own
    // internal refs; they die with this component instance.
    useEffect(() => {
      return () => {
        dispatch(clearActivePlaybackMetadata());
      };
    }, [dispatch]);

    return (
      <StitcherContainer
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleCanvasDrop}
      >
        {hasStitchedData ? (
          <VisualizationContainer>
            <FFTAndWaterfall
              ref={forwardedRef}
              dataRef={fftCanvasDataRef}
              frequencyRange={frequencyRange}
              centerFrequencyHz={(frequencyRange.min + frequencyRange.max) / 2}
              activeSignalArea="Stitched"
              isPaused={isPaused}
              snapshotGridPreference={snapshotGridPreference ?? true}
              displayTemporalResolution={displayTemporalResolution}
              vizZoom={vizZoom}
              vizZoomFloor={vizZoomFloor}
              vizZoomFloorPan={vizZoomFloorPan}
              vizPanOffset={vizPanOffset}
              autoZoomStability={autoZoomStability}
              onVizZoomChange={onVizZoomChange}
              onVizZoomFloorChange={onVizZoomFloorChange}
              onVizZoomFloorPanChange={onVizZoomFloorPanChange}
              onVizPanChange={onVizPanChange}
              fftMin={fftMin}
              fftMax={fftMax}
              onFftDbLimitsChange={onFftDbLimitsChange}
              hardwareSampleRateHz={hardwareSampleRateHz}
              isIqRecordingActive={true}
              fftFrameRate={activeChannelInfo.frameRate}
              powerScale={powerScale}
              removeDcSpike={removeDcSpike}
              visualizerMachine={visualizerMachine}
              visualizerSessionKey={visualizerSessionKey}
              pauseSnapshotEnabled={shouldRestorePausedFrameSnapshot({
                sourceMode: "file",
              })}
              canvasStatusRow={playbackCanvasStatusRow}
              onLoadingStateChange={setSnapshotButtonsLoading}
              awaitingDeviceData={false}
              headerActionContent={fastSpectrumSnapshotAction}
              waterfallHeaderActionContent={fastWaterfallSnapshotAction}
            />
            <ChannelSelector
              channelCount={channelCount}
              activeChannel={activeChannel}
              channelLabel={activeChannelInfo.label}
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
            {stitchStatus.toLowerCase().includes("decryption") ? (
              <div style={{ maxWidth: "400px", margin: "0 auto" }}>
                <DecryptionFallback
                  moduleName="File Processing"
                  errorType="vault"
                />
              </div>
            ) : (
              <HelpText>
                {selectedFiles.length > 0
                  ? "Click Stitch/Process to visualize"
                  : "Drop .napt, .iq, or .wav files here"}
              </HelpText>
            )}
          </EmptyContainer>
        )}
      </StitcherContainer>
    );
  },
);

export default memo(FFTPlaybackCanvas);

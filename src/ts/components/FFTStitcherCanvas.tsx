import React, { useState, useEffect, useRef, useCallback } from "react";
import styled from "styled-components";
import { FFTCanvas } from "@n-apt/components";
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";

interface FFTStitcherCanvasProps {
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

const FFTStitcherCanvas: React.FC<FFTStitcherCanvasProps> = ({
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
}) => {
  const { aesKey } = useAuthentication();
  const aesKeyRef = useRef(aesKey);

  useEffect(() => {
    aesKeyRef.current = aesKey;
  }, [aesKey]);

  // ── Stable refs for data that changes rapidly (no re-render cascades) ──
  const fileDataCache = useRef<Map<string, number[]>>(new Map());
  const freqMapRef = useRef<Map<string, number>>(new Map());
  const lastTriggerRef = useRef<number | null>(null);
  const playbackFrameRef = useRef(0);
  const selectedFilesRef = useRef(selectedFiles);
  selectedFilesRef.current = selectedFiles;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const stitchSourceSettingsRef = useRef(stitchSourceSettings);
  stitchSourceSettingsRef.current = stitchSourceSettings;
  const prevFileNamesRef = useRef<string>("");

  // ── Worker data refs ──
  const workerFileDataCache = useRef<[string, number[]][]>([]);
  const workerFreqMap = useRef<[string, number][]>([]);
  const workerMetadataMap = useRef<[string, any][]>([]);
  const precomputedFrames = useRef<any[]>([]);
  const maxFrames = useRef<number>(0);

  // ── State: only things that control what JSX branch renders ──
  const [hasStitchedData, setHasStitchedData] = useState(false);
  const [frequencyRange, setFrequencyRange] = useState({ min: 0.0, max: 3.2 });
  const [channelCount, setChannelCount] = useState(0);
  const [activeChannel, setActiveChannel] = useState(0);
  const allChannelsRef = useRef<any[]>([]);

  /**
   * Hot-path data ref — written directly by the animation loop, never via
   * React state.  FFTCanvas reads this ref on every rAF, identical to the
   * live-view data path in useWebSocket → dataRef.current.
   */
  const fftCanvasDataRef = useRef<any>(null);

  const setStitchStatus = useCallback(
    (status: string) => {
      onStitchStatus?.(status);
    },
    [onStitchStatus],
  );

  // ── Stitch: loads files, produces first frame, sets hasStitchedData ──
  const stitchFiles = useCallback(async () => {
    const currentFiles = selectedFilesRef.current;
    if (currentFiles.length === 0) {
      setStitchStatus("No files selected for stitching");
      return;
    }

    setStitchStatus(`Loading ${currentFiles.length} files...`);
    freqMapRef.current.clear();
    fileDataCache.current.clear();

    try {
      // Use file worker for stitching
      const result = await fileWorkerManager.stitchFiles(
        currentFiles,
        stitchSourceSettingsRef.current,
        fftSize,
        (progress: any) => {
          setStitchStatus(
            progress.status ||
            `Loading ${progress.current}/${progress.total} files...`,
          );
        },
        aesKeyRef.current,
      );

      if (!result.stitchedData) {
        throw new Error("Failed to stitch files");
      }

      // Store worker data in refs for frame building
      workerFileDataCache.current = result.fileDataCache;
      workerFreqMap.current = result.freqMap;
      workerMetadataMap.current = result.metadataMap || [];
      precomputedFrames.current = result.precomputedFrames;
      maxFrames.current = result.maxFrames;

      // Handle multi-channel metadata from worker
      const firstFileMeta = result.metadataMap && result.metadataMap[0] ? result.metadataMap[0][1] : null;
      const channels = firstFileMeta?.channels_data || result.channels || [];
      allChannelsRef.current = channels;
      setChannelCount(channels.length);
      setActiveChannel(0);

      // Set frequency range from the first channel/file
      if (channels.length > 0) {
        const ch = channels[0];
        const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
        const center = (ch.center_freq_hz || 0) / 1_000_000;
        setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
      } else if (result.range) {
        setFrequencyRange(result.range);
      }

      setHasStitchedData(true);
      setStitchStatus(currentFiles.length > 1 ? "Stitched Successfully" : "Processed Successfully");
    } catch (error: any) {
      console.error("Stitch error:", error);
      setStitchStatus(`Stitch failed: ${error.message}`);
    }
  }, [setStitchStatus, fftSize]);

  // ── Build combined frame via worker ──
  const buildCombinedFrame = useCallback(async (frame: number) => {
    try {
      if (precomputedFrames.current.length > 0) {
        const frameIndex = frame % (maxFrames.current || 1);
        const result = await fileWorkerManager.getFrame(
          frameIndex,
          precomputedFrames.current,
        );
        return result.frame;
      }

      const result = await fileWorkerManager.buildFrame(
        frame,
        workerFileDataCache.current,
        workerFreqMap.current,
        workerMetadataMap.current,
      );
      return result.frame;
    } catch (error) {
      console.warn("Worker frame building failed:", error);
      return null;
    }
  }, []);

  // ── Trigger: respond to parent's stitch button click ──
  useEffect(() => {
    if (lastTriggerRef.current === null) {
      lastTriggerRef.current = stitchTrigger;
      return;
    }
    if (stitchTrigger !== null && stitchTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = stitchTrigger;
      stitchFiles();
    }
  }, [stitchTrigger, stitchFiles]);

  // ── Playback loop: runs only when unpaused + has data ──
  const animateFrame = useCallback(
    (timestamp: number) => {
      if (isPausedRef.current) return;

      const channels = allChannelsRef.current;
      const chIdx = activeChannel;

      if (channels.length > 0 && channels[chIdx]) {
        const ch = channels[chIdx];
        const frames = ch.spectrum_frames || [];
        if (frames.length > 0) {
          const frameIdx = Math.floor(timestamp / 50) % frames.length;
          // Frames from the file are already Float32Arrays
          fftCanvasDataRef.current = { waveform: frames[frameIdx] };
        }
      } else if (precomputedFrames.current.length > 0) {
        const frameIdx = Math.floor(timestamp / 50) % precomputedFrames.current.length;
        // Precomputed frames are already objects like { waveform, range }
        fftCanvasDataRef.current = precomputedFrames.current[frameIdx];
      }
    },
    [activeChannel],
  );

  useEffect(() => {
    if (!hasStitchedData || isPaused) return;

    let animationFrameId: number | null = null;
    const currentRunId = Math.random();
    const runIdRef = { current: currentRunId };

    const loop = (timestamp: number) => {
      if (isPausedRef.current || runIdRef.current !== currentRunId) {
        animationFrameId = null;
        return;
      }

      animateFrame(timestamp);
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      runIdRef.current = 0;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [hasStitchedData, isPaused, animateFrame]);

  // ── Clear when file selection actually changes ──
  useEffect(() => {
    const nameKey = selectedFiles
      .map((f) => f.name)
      .sort()
      .join("|");
    if (nameKey === prevFileNamesRef.current) return;
    prevFileNamesRef.current = nameKey;

    fftCanvasDataRef.current = null;
    setHasStitchedData(false);
    setStitchStatus("");
    playbackFrameRef.current = 0;
    fileDataCache.current.clear();
    freqMapRef.current.clear();
    allChannelsRef.current = [];
    setChannelCount(0);
    setActiveChannel(0);
  }, [selectedFiles, setStitchStatus]);

  return (
    <StitcherContainer>
      {hasStitchedData ? (
        <VisualizationContainer>
          <FFTCanvas
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
          />
          {channelCount > 1 && (
            <div style={{
              position: "absolute",
              top: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(0,0,0,0.8)",
              padding: "4px 12px",
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
                onClick={() => {
                  if (activeChannel > 0) {
                    const newIdx = activeChannel - 1;
                    setActiveChannel(newIdx);
                    const ch = allChannelsRef.current[newIdx];
                    const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
                    const center = (ch.center_freq_hz || 0) / 1_000_000;
                    setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
                  }
                }}
              >
                &lt;
              </span>
              <span>Channel {activeChannel + 1} / {channelCount}</span>
              <span
                style={{ cursor: "pointer", opacity: activeChannel < channelCount - 1 ? 1 : 0.3 }}
                onClick={() => {
                  if (activeChannel < channelCount - 1) {
                    const newIdx = activeChannel + 1;
                    setActiveChannel(newIdx);
                    const ch = allChannelsRef.current[newIdx];
                    const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
                    const center = (ch.center_freq_hz || 0) / 1_000_000;
                    setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
                  }
                }}
              >
                &gt;
              </span>
            </div>
          )}
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
};

export default FFTStitcherCanvas;

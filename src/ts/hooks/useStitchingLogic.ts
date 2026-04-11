import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import {
  createStitchSessionKey,
  getStitchSession,
  setStitchSession,
} from "@n-apt/utils/stitchSessionCache";

interface UseStitchingLogicProps {
  selectedFiles: { id: string; name: string }[];
  stitchTrigger: number | null;
  stitchSourceSettings: { gain: number; ppm: number };
  fftSize: number;
  onStitchStatus?: (status: string) => void;
  onChannelsChange?: (channels: any[]) => void;
  onProcessedDataChange?: (hasData: boolean) => void;
  sampleRateOptions?: { maxSampleRateHz: number; currentSampleRateHz: number };
}

interface StitchingResult {
  hasStitchedData: boolean;
  frequencyRange: { min: number; max: number };
  channelCount: number;
  activeChannel: number;
  hardwareSampleRateHz?: number;
  allChannelsRef: React.MutableRefObject<any[]>;
  workerFileDataCache: React.MutableRefObject<[string, Uint8Array | number[]][]>;
  workerFreqMap: React.MutableRefObject<[string, number][]>;
  workerMetadataMap: React.MutableRefObject<[string, any][]>;
  precomputedFrames: React.MutableRefObject<any[]>;
  maxFrames: React.MutableRefObject<number>;
  setChannelCount: (count: number) => void;
  setActiveChannel: (channel: number) => void;
  setFrequencyRange: (range: { min: number; max: number }) => void;
  setHardwareSampleRateHz: (hz: number | undefined) => void;
  stitchFiles: () => Promise<void>;
}

export const useStitchingLogic = ({
  selectedFiles,
  stitchTrigger,
  stitchSourceSettings,
  fftSize,
  onStitchStatus,
  onChannelsChange,
  onProcessedDataChange,
  sampleRateOptions,
}: UseStitchingLogicProps): StitchingResult => {
  const { aesKey } = useAuthentication();
  const aesKeyRef = useRef(aesKey);
  const onStitchStatusRef = useRef(onStitchStatus);
  const restoredSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    aesKeyRef.current = aesKey;
  }, [aesKey]);

  useEffect(() => {
    onStitchStatusRef.current = onStitchStatus;
  }, [onStitchStatus]);

  // State
  const [hasStitchedData, setHasStitchedData] = useState(false);
  const [frequencyRange, setFrequencyRange] = useState({ min: 0.0, max: 3.2 });
  const [channelCount, setChannelCount] = useState(0);
  const [activeChannel, setActiveChannel] = useState(0);
  const [hardwareSampleRateHz, setHardwareSampleRateHz] = useState<number | undefined>(undefined);

  // Refs for data that changes rapidly
  const selectedFilesRef = useRef(selectedFiles);
  selectedFilesRef.current = selectedFiles;
  const stitchSourceSettingsRef = useRef(stitchSourceSettings);
  stitchSourceSettingsRef.current = stitchSourceSettings;
  const lastTriggerRef = useRef<number | null>(null);
  const selectedFileNamesKey = useMemo(
    () => selectedFiles.map((f) => f.name).sort().join("|"),
    [selectedFiles],
  );
  const lastProcessedFilesRef = useRef<string[]>(
    selectedFileNamesKey ? selectedFileNamesKey.split("|") : []
  );

  // Reset stitched state when file selection changes
  useEffect(() => {
    const currentFileNames = selectedFileNamesKey.length > 0
      ? selectedFileNamesKey.split("|")
      : [];
    const lastFileNames = lastProcessedFilesRef.current;
    if (JSON.stringify(currentFileNames) !== JSON.stringify(lastFileNames)) {
      setHasStitchedData(false);
      onStitchStatusRef.current?.("");
      // Update this so we don't keep resetting until the next process
      lastProcessedFilesRef.current = currentFileNames;
    }
  }, [selectedFileNamesKey]);

  // Worker data refs
  const workerFileDataCache = useRef<[string, Uint8Array | number[]][]>([]);
  const workerFreqMap = useRef<[string, number][]>([]);
  const workerMetadataMap = useRef<[string, any][]>([]);
  const precomputedFrames = useRef<any[]>([]);
  const maxFrames = useRef<number>(0);
  const allChannelsRef = useRef<any[]>([]);
  const stitchSessionKey = useMemo(
    () =>
      createStitchSessionKey({
        selectedFiles,
        settings: stitchSourceSettings,
        fftSize,
        sampleRateOptions,
      }),
    [fftSize, sampleRateOptions, selectedFiles, stitchSourceSettings],
  );

  const setStitchStatus = useCallback((status: string) => {
    onStitchStatusRef.current?.(status);
  }, []);

  useEffect(() => {
    if (selectedFiles.length === 0) return;

    const cachedSession = getStitchSession(stitchSessionKey);
    if (!cachedSession) {
      if (restoredSessionKeyRef.current !== stitchSessionKey) {
        restoredSessionKeyRef.current = stitchSessionKey;
        setHasStitchedData(false);
        onStitchStatus?.("");
        onChannelsChange?.([]);
        onProcessedDataChange?.(false);
      }
      return;
    }
    
    if (restoredSessionKeyRef.current === stitchSessionKey) return;
    restoredSessionKeyRef.current = stitchSessionKey;

    workerFileDataCache.current = cachedSession.workerFileDataCache;
    workerFreqMap.current = cachedSession.workerFreqMap;
    workerMetadataMap.current = cachedSession.workerMetadataMap;
    precomputedFrames.current = cachedSession.precomputedFrames;
    maxFrames.current = cachedSession.maxFrames;
    allChannelsRef.current = cachedSession.allChannels;
    setFrequencyRange(cachedSession.frequencyRange);
    setChannelCount(cachedSession.channelCount);
    setActiveChannel(cachedSession.activeChannel);
    setHardwareSampleRateHz(cachedSession.hardwareSampleRateHz);
    setHasStitchedData(cachedSession.hasStitchedData);
    setStitchStatus(cachedSession.stitchStatus);
    onChannelsChange?.(cachedSession.allChannels);
    onProcessedDataChange?.(true);
  }, [selectedFiles.length, setStitchStatus, stitchSessionKey, onStitchStatus, onChannelsChange, onProcessedDataChange]);

  const stitchFiles = useCallback(async () => {
    const currentFiles = selectedFilesRef.current;
    if (currentFiles.length === 0) {
      setStitchStatus("No files selected for stitching");
      return;
    }

    setStitchStatus(`Loading ${currentFiles.length} files...`);
    
    // Check if files have changed to force reset
    const currentFileNames = currentFiles.map(f => f.name).sort();
    const lastFileNames = lastProcessedFilesRef.current;
    const filesChanged = JSON.stringify(currentFileNames) !== JSON.stringify(lastFileNames);
    
    // Clear previous data
    workerFreqMap.current = [];
    workerFileDataCache.current = [];
    precomputedFrames.current = [];
    
    // Reset to first channel if files changed
    if (filesChanged) {
      setActiveChannel(0);
      lastProcessedFilesRef.current = currentFileNames;
    }

    try {
      restoredSessionKeyRef.current = null;
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
        sampleRateOptions, // Pass dynamic sample rate options
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
      
      // Extract the TRUE per-hop hardware sample rate from raw_hardware_blocks
      const rawBlocks = firstFileMeta?.raw_hardware_blocks;
      const hwHz = (rawBlocks && rawBlocks.length > 0)
        ? rawBlocks[0].sample_rate_hz
        : (firstFileMeta?.hardware_sample_rate_hz || firstFileMeta?.capture_sample_rate_hz);

      allChannelsRef.current = channels;
      setHardwareSampleRateHz(hwHz);
      setChannelCount(channels.length);
      setActiveChannel(0);

      // Prefer the first stitched channel's requested range on initial render.
      // This avoids briefly showing the file-wide multi-channel span before the
      // active-channel metadata catches up.
      const firstChannel = channels.length > 0 ? channels[0] : null;
      const firstChannelRange =
        Array.isArray(firstChannel?.frequency_range) &&
        firstChannel.frequency_range.length === 2 &&
        Number.isFinite(firstChannel.frequency_range[0]) &&
        Number.isFinite(firstChannel.frequency_range[1])
          ? firstChannel.frequency_range
          : null;
      const requestedRange = firstFileMeta?.frequency_range;
      if (firstChannelRange) {
        setFrequencyRange({ min: firstChannelRange[0], max: firstChannelRange[1] });
      } else if (
        Array.isArray(requestedRange) &&
        requestedRange.length === 2 &&
        Number.isFinite(requestedRange[0]) &&
        Number.isFinite(requestedRange[1])
      ) {
        setFrequencyRange({ min: requestedRange[0], max: requestedRange[1] });
      } else if (firstChannel) {
        const span = (firstChannel.sample_rate_hz || 3200000) / 1_000_000;
        const center = (firstChannel.center_freq_hz || 0) / 1_000_000;
        setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
      } else if (result.range) {
        setFrequencyRange(result.range);
      }

      setHasStitchedData(true);
      const nextStitchStatus =
        currentFiles.length > 1
          ? "Stitched Successfully"
          : "Processed Successfully";
      onStitchStatus(nextStitchStatus);
      onChannelsChange?.(channels);
      onProcessedDataChange?.(true);
      setStitchSession(stitchSessionKey, {
        hasStitchedData: true,
        frequencyRange: firstChannelRange
          ? { min: firstChannelRange[0], max: firstChannelRange[1] }
          : result.range ?? frequencyRange,
        channelCount: channels.length,
        activeChannel: 0,
        hardwareSampleRateHz: hwHz,
        workerFileDataCache: result.fileDataCache,
        workerFreqMap: result.freqMap,
        workerMetadataMap: result.metadataMap || [],
        precomputedFrames: result.precomputedFrames,
        maxFrames: result.maxFrames,
        allChannels: channels,
        stitchStatus: nextStitchStatus,
      });
    } catch (error: any) {
      console.error("Stitch error:", error);
      setStitchStatus(`Stitch failed: ${error.message}`);
    }
  }, [fftSize, frequencyRange, sampleRateOptions, setStitchStatus, stitchSessionKey]);

  // Trigger: respond to parent's stitch button click
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

  return {
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
    maxFrames,
    setChannelCount,
    setActiveChannel,
    setFrequencyRange,
    setHardwareSampleRateHz,
    stitchFiles,
  };
};

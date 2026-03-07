import { useState, useEffect, useRef, useCallback } from "react";
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";

interface UseStitchingLogicProps {
  selectedFiles: { name: string; file: File }[];
  stitchTrigger: number | null;
  stitchSourceSettings: { gain: number; ppm: number };
  fftSize: number;
  onStitchStatus?: (status: string) => void;
}

interface StitchingResult {
  hasStitchedData: boolean;
  frequencyRange: { min: number; max: number };
  channelCount: number;
  activeChannel: number;
  hardwareSampleRateHz?: number;
  allChannelsRef: React.MutableRefObject<any[]>;
  workerFileDataCache: React.MutableRefObject<[string, number[]][]>;
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
}: UseStitchingLogicProps): StitchingResult => {
  const { aesKey } = useAuthentication();
  const aesKeyRef = useRef(aesKey);

  useEffect(() => {
    aesKeyRef.current = aesKey;
  }, [aesKey]);

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
  const lastProcessedFilesRef = useRef<string[]>([]);

  // Reset stitched state when file selection changes
  useEffect(() => {
    const currentFileNames = selectedFiles.map((f) => f.name).sort();
    const lastFileNames = lastProcessedFilesRef.current;
    if (JSON.stringify(currentFileNames) !== JSON.stringify(lastFileNames)) {
      setHasStitchedData(false);
      onStitchStatus?.("");
      // Update this so we don't keep resetting until the next process
      lastProcessedFilesRef.current = currentFileNames;
    }
  }, [selectedFiles, onStitchStatus]);

  // Worker data refs
  const workerFileDataCache = useRef<[string, number[]][]>([]);
  const workerFreqMap = useRef<[string, number][]>([]);
  const workerMetadataMap = useRef<[string, any][]>([]);
  const precomputedFrames = useRef<any[]>([]);
  const maxFrames = useRef<number>(0);
  const allChannelsRef = useRef<any[]>([]);

  const setStitchStatus = useCallback(
    (status: string) => {
      onStitchStatus?.(status);
    },
    [onStitchStatus],
  );

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
      
      // Extract the TRUE per-hop hardware sample rate from raw_hardware_blocks
      const rawBlocks = firstFileMeta?.raw_hardware_blocks;
      const hwHz = (rawBlocks && rawBlocks.length > 0)
        ? rawBlocks[0].sample_rate_hz
        : (firstFileMeta?.hardware_sample_rate_hz || firstFileMeta?.capture_sample_rate_hz);

      allChannelsRef.current = channels;
      setHardwareSampleRateHz(hwHz);
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

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useOfflinePlayback } from "@n-apt/app/hooks/OfflinePlaybackContext";
import {
  createStitchSessionKey,
  getStitchSession,
  setStitchSession,
} from "@n-apt/spectrum/utils/stitchSessionCache";
import type { StitchState } from "@n-apt/redux/slices/waterfallSlice";

interface UseStitchingLogicProps {
  selectedFiles: { id: string; name: string }[];
  stitchTrigger: number | null;
  stitchSourceSettings: { gain: number; ppm: number };
  fftSize: number;
  onStitchStatus?: (status: string, state: StitchState) => void;
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
  workerFileDataCache: React.MutableRefObject<
    [string, Uint8Array | number[]][]
  >;
  workerFreqMap: React.MutableRefObject<[string, number][]>;
  workerMetadataMap: React.MutableRefObject<[string, any][]>;
  precomputedFrames: React.MutableRefObject<any[]>;
  maxFrames: React.MutableRefObject<number>;
  setChannelCount: (count: number) => void;
  setActiveChannel: (channel: number) => void;
  setFrequencyRange: (range: { min: number; max: number }) => void;
  setHardwareSampleRateHz: (hz: number | undefined) => void;
  stitchFiles: (allowIntegrityFailure?: boolean) => Promise<void>;
  playIntegrityFailedFile: () => Promise<void>;
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
  const { aesKey, fidoVaultKey } = useAuthentication();
  const offlinePlayback = useOfflinePlayback();
  const aesKeyRef = useRef(
    offlinePlayback.mode === "password" ? offlinePlayback.key : aesKey,
  );
  const fidoVaultKeyRef = useRef(fidoVaultKey);
  const offlineKeyRef = useRef(offlinePlayback.key);
  const offlineModeRef = useRef(offlinePlayback.mode);
  const offlineCaptureSaltRef = useRef(offlinePlayback.captureSalt);
  const offlineEnabledRef = useRef(offlinePlayback.enabled);
  const offlineCredentialVersionRef = useRef(0);
  const previousOfflineKeyRef = useRef(Boolean(offlinePlayback.key));
  const previousFidoKeyAvailableRef = useRef(Boolean(fidoVaultKey));
  const onStitchStatusRef = useRef(onStitchStatus);
  const restoredSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    aesKeyRef.current =
      offlinePlayback.mode === "password" ? offlinePlayback.key : aesKey;
  }, [aesKey, offlinePlayback.key, offlinePlayback.mode]);

  useEffect(() => {
    fidoVaultKeyRef.current = fidoVaultKey;
  }, [fidoVaultKey]);

  useEffect(() => {
    onStitchStatusRef.current = onStitchStatus;
  }, [onStitchStatus]);

  // Refs for data that changes rapidly
  const selectedFilesRef = useRef(selectedFiles);
  const stitchSourceSettingsRef = useRef(stitchSourceSettings);
  useLayoutEffect(() => {
    selectedFilesRef.current = selectedFiles;
    stitchSourceSettingsRef.current = stitchSourceSettings;
  }, [selectedFiles, stitchSourceSettings]);
  const lastTriggerRef = useRef(stitchTrigger);
  const selectedFileNamesKey = useMemo(
    () =>
      selectedFiles
        .map((f) => f.name)
        .sort()
        .join("|"),
    [selectedFiles],
  );
  const selectedFileIdentityKey = useMemo(
    () =>
      selectedFiles
        .map((file) => `${file.id}:${file.name}`)
        .sort()
        .join("|"),
    [selectedFiles],
  );
  const lastAutoStitchKeyRef = useRef<string | null>(null);
  const inFlightStitchKeysRef = useRef(new Set<string>());
  const lastProcessedFilesRef = useRef<string[]>(
    selectedFileNamesKey ? selectedFileNamesKey.split("|") : [],
  );

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

  const [mountSeed] = useState(() => ({
    key: stitchSessionKey,
    identityKey: selectedFileIdentityKey,
    session: offlinePlayback.enabled ? null : getStitchSession(stitchSessionKey),
  }));
  const cachedOnMount = mountSeed.session;
  const workerFileDataCache = useRef<[string, Uint8Array | number[]][]>(
    cachedOnMount?.workerFileDataCache ?? [],
  );
  const workerFreqMap = useRef<[string, number][]>(cachedOnMount?.workerFreqMap ?? []);
  const workerMetadataMap = useRef<[string, any][]>(cachedOnMount?.workerMetadataMap ?? []);
  const precomputedFrames = useRef<any[]>(cachedOnMount?.precomputedFrames ?? []);
  const maxFrames = useRef(cachedOnMount?.maxFrames ?? 0);
  const allChannelsRef = useRef<any[]>(cachedOnMount?.allChannels ?? []);

  // State - initialize from cache if available
  const [hasStitchedData, setHasStitchedData] = useState(!!cachedOnMount);
  const [frequencyRange, setFrequencyRange] = useState(
    cachedOnMount?.frequencyRange || { min: 0.0, max: 3.2 },
  );
  const [channelCount, setChannelCount] = useState(
    cachedOnMount?.channelCount || 0,
  );
  const [activeChannel, setActiveChannel] = useState(
    cachedOnMount?.activeChannel || 0,
  );
  const [hardwareSampleRateHz, setHardwareSampleRateHz] = useState<
    number | undefined
  >(cachedOnMount?.hardwareSampleRateHz);
  const frequencyRangeRef = useRef(frequencyRange);
  useLayoutEffect(() => {
    frequencyRangeRef.current = frequencyRange;
  }, [frequencyRange]);

  useEffect(() => {
    const credentialsChanged =
      offlineKeyRef.current !== offlinePlayback.key ||
      offlineModeRef.current !== offlinePlayback.mode ||
      offlineCaptureSaltRef.current !== offlinePlayback.captureSalt ||
      offlineEnabledRef.current !== offlinePlayback.enabled;
    if (credentialsChanged) offlineCredentialVersionRef.current += 1;
    offlineKeyRef.current = offlinePlayback.key;
    offlineModeRef.current = offlinePlayback.mode;
    offlineCaptureSaltRef.current = offlinePlayback.captureSalt;
    offlineEnabledRef.current = offlinePlayback.enabled;

    const hadKey = previousOfflineKeyRef.current;
    previousOfflineKeyRef.current = Boolean(offlinePlayback.key);
    if (hadKey && !offlinePlayback.key) {
      clearStitchSession(stitchSessionKey);
      setHasStitchedData(false);
      workerFileDataCache.current = [];
      workerFreqMap.current = [];
      workerMetadataMap.current = [];
      precomputedFrames.current = [];
      maxFrames.current = 0;
      allChannelsRef.current = [];
      setChannelCount(0);
      onChannelsChange?.([]);
      onProcessedDataChange?.(false);
    }
  }, [
    offlinePlayback.key,
    offlinePlayback.mode,
    offlinePlayback.captureSalt,
    offlinePlayback.enabled,
    stitchSessionKey,
    onChannelsChange,
    onProcessedDataChange,
    setChannelCount,
  ]);


  const setStitchStatus = useCallback((status: string, state: StitchState) => {
    onStitchStatusRef.current?.(status, state);
  }, []);

  // Reset stitched state when file selection changes
  useEffect(() => {
    const currentFileNames =
      selectedFileNamesKey.length > 0 ? selectedFileNamesKey.split("|") : [];
    const lastFileNames = lastProcessedFilesRef.current;
    if (JSON.stringify(currentFileNames) !== JSON.stringify(lastFileNames)) {
      setHasStitchedData(false);
      onStitchStatusRef.current?.("", "idle");
      // Update this so we don't keep resetting until the next process
      lastProcessedFilesRef.current = currentFileNames;
    }
  }, [selectedFileNamesKey]);

  // Persist session changes (paged channels, etc.) back to cache
  useEffect(() => {
    if (!hasStitchedData) return;
    const session = getStitchSession(stitchSessionKey);
    if (session) {
      setStitchSession(stitchSessionKey, {
        ...session,
        activeChannel,
        frequencyRange,
      });
    }
  }, [activeChannel, frequencyRange, hasStitchedData, stitchSessionKey]);

  // Restore cached session data and publish to parents exactly once, during
  // the commit phase before paint; never from render, so a suspended first
  // published render cannot publish before it is committed.
  useLayoutEffect(() => {
    if (!cachedOnMount || restoredSessionKeyRef.current) return;
    workerFileDataCache.current = cachedOnMount.workerFileDataCache;
    workerFreqMap.current = cachedOnMount.workerFreqMap;
    workerMetadataMap.current = cachedOnMount.workerMetadataMap;
    precomputedFrames.current = cachedOnMount.precomputedFrames;
    maxFrames.current = cachedOnMount.maxFrames;
    allChannelsRef.current = cachedOnMount.allChannels;
    restoredSessionKeyRef.current = mountSeed.key;
    onChannelsChange?.(cachedOnMount.allChannels);
    onProcessedDataChange?.(true);
  }, []);

  const stitchFiles = useCallback(async (allowIntegrityFailure = false) => {
    const currentFiles = selectedFilesRef.current;
    if (currentFiles.length === 0) {
      setStitchStatus("No files selected for stitching", "idle");
      return;
    }

    const requestIdentityKey = currentFiles
      .map((file) => `${file.id}:${file.name}`)
      .sort()
      .join("|");
    const requestCredentialVersion = offlineCredentialVersionRef.current;
    const inFlightKey = `${requestIdentityKey}:${allowIntegrityFailure}:${requestCredentialVersion}`;
    if (inFlightStitchKeysRef.current.has(inFlightKey)) return;
    inFlightStitchKeysRef.current.add(inFlightKey);

    setStitchStatus(`Loading ${currentFiles.length} files...`, "loading");

    // Check if files have changed to force reset
    const currentFileNames = currentFiles.map((f) => f.name).sort();
    const lastFileNames = lastProcessedFilesRef.current;
    const filesChanged =
      JSON.stringify(currentFileNames) !== JSON.stringify(lastFileNames);

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
      const offlineKey = offlineKeyRef.current;
      const offlineMode = offlineModeRef.current;
      const effectiveAesKey =
        offlineMode === "password" ? offlineKey : aesKeyRef.current;
      let effectiveFidoVaultKey = fidoVaultKeyRef.current;
      let offlineFidoVaultKeyBytes: Uint8Array | null = null;
      if (offlineMode === "fido" && offlineKey) {
        offlineFidoVaultKeyBytes = new Uint8Array(
          await crypto.subtle.exportKey("raw", offlineKey),
        );
        effectiveFidoVaultKey = offlineFidoVaultKeyBytes;
      }
      let result: any;
      try {
        result = await fileWorkerManager.stitchFiles(
          currentFiles,
          stitchSourceSettingsRef.current,
          fftSize,
          (progress: any) => {
            setStitchStatus(
              progress.status ||
                `Loading ${progress.current}/${progress.total} files...`,
              "loading",
            );
          },
          effectiveAesKey,
          sampleRateOptions, // Pass dynamic sample rate options
          allowIntegrityFailure,
          effectiveFidoVaultKey,
          offlineCaptureSaltRef.current,
        );
      } finally {
        offlineFidoVaultKeyBytes?.fill(0);
      }

      // A newer selection may have started processing while this worker
      // request was running. Do not let an older result replace it.
      const currentIdentityKey = selectedFilesRef.current
        .map((file) => `${file.id}:${file.name}`)
        .sort()
        .join("|");
      if (
        currentIdentityKey !== requestIdentityKey ||
        requestCredentialVersion !== offlineCredentialVersionRef.current
      ) return;

      if (!result.stitchedData) {
        throw new Error("Failed to process file segments");
      }

      // Store worker data in refs for frame building
      workerFileDataCache.current = result.fileDataCache;
      workerFreqMap.current = result.freqMap;
      workerMetadataMap.current = result.metadataMap || [];
      precomputedFrames.current = result.precomputedFrames;
      maxFrames.current = result.maxFrames;

      // Handle multi-channel metadata from worker
      const firstFileMeta =
        result.metadataMap && result.metadataMap[0]
          ? result.metadataMap[0][1]
          : null;
      const channels = firstFileMeta?.channels_data || result.channels || [];

      // Extract the TRUE per-hop hardware sample rate from raw_hardware_blocks
      const rawBlocks = firstFileMeta?.raw_hardware_blocks;
      const hwHz =
        rawBlocks && rawBlocks.length > 0
          ? rawBlocks[0].sample_rate_hz
          : firstFileMeta?.hardware_sample_rate_hz ||
            firstFileMeta?.capture_sample_rate_hz;

      allChannelsRef.current = channels;
      setHardwareSampleRateHz(hwHz);
      setChannelCount(channels.length);
      setActiveChannel(0);

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
        setFrequencyRange({
          min: firstChannelRange[0],
          max: firstChannelRange[1],
        });
      } else if (
        Array.isArray(requestedRange) &&
        requestedRange.length === 2 &&
        Number.isFinite(requestedRange[0]) &&
        Number.isFinite(requestedRange[1])
      ) {
        setFrequencyRange({ min: requestedRange[0], max: requestedRange[1] });
      } else if (firstChannel) {
        const span = firstChannel.sample_rate_hz || 3_200_000;
        const center = firstChannel.center_freq_hz || 0;
        setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
      } else if (result.range) {
        setFrequencyRange(result.range);
      }

      setHasStitchedData(true);
      if (offlineEnabledRef.current) offlinePlayback.markDecrypted();
      const nextStitchStatus =
        currentFiles.length > 1
          ? "Stitched Successfully"
          : "Processed Successfully";
      setStitchStatus(nextStitchStatus, "ready");
      onChannelsChange?.(channels);
      onProcessedDataChange?.(true);
      if (!offlineEnabledRef.current) {
        setStitchSession(stitchSessionKey, {
          hasStitchedData: true,
          frequencyRange: firstChannelRange
            ? { min: firstChannelRange[0], max: firstChannelRange[1] }
            : (result.range ?? frequencyRangeRef.current),
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
      }
    } catch (error: any) {
      if (requestCredentialVersion !== offlineCredentialVersionRef.current) return;
      console.error("Stitch error:", error);
      const msg = error.message || String(error);
      const normalizedMessage = msg.toLowerCase();
      if (offlineEnabledRef.current) offlinePlayback.setError(msg);
      if (normalizedMessage.includes("integrity_failed")) {
        setStitchStatus(
          "File integrity failed: file appears corrupted or modified",
          "error",
        );
      } else if (
        normalizedMessage.includes("fido vault key is not available")
      ) {
        setStitchStatus(
          "FIDO vault decryption requires unlocking your security key",
          "error",
        );
      } else if (normalizedMessage.includes("decryption")) {
        setStitchStatus("File decryption failed, wrong key", "error");
      } else {
        setStitchStatus(msg, "error");
      }
    } finally {
      inFlightStitchKeysRef.current.delete(inFlightKey);
    }
  }, [
    fftSize,
    sampleRateOptions,
    setStitchStatus,
    stitchSessionKey,
    setHasStitchedData,
    setHardwareSampleRateHz,
    setChannelCount,
    setActiveChannel,
    setFrequencyRange,
    onStitchStatus,
    onChannelsChange,
    onProcessedDataChange,
    offlinePlayback.markDecrypted,
    offlinePlayback.setError,
  ]);

  useEffect(() => {
    if (!offlinePlayback.enabled || !offlinePlayback.key) return;
    void stitchFiles();
  }, [offlinePlayback.enabled, offlinePlayback.key, stitchFiles]);

  const playIntegrityFailedFile = useCallback(
    () => stitchFiles(true),
    [stitchFiles],
  );

  // Trigger: respond to parent's stitch button click
  useEffect(() => {
    if (lastTriggerRef.current === null) {
      lastTriggerRef.current = stitchTrigger;
      if (selectedFilesRef.current.length > 0) {
        void stitchFiles();
      }
      return;
    }
    if (stitchTrigger !== null && stitchTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = stitchTrigger;
      stitchFiles();
    }
  }, [stitchTrigger, stitchFiles]);

  useEffect(() => {
    const wasAvailable = previousFidoKeyAvailableRef.current;
    const isAvailable = Boolean(fidoVaultKey);
    previousFidoKeyAvailableRef.current = isAvailable;
    if (!wasAvailable && isAvailable && selectedFileIdentityKey) {
      void stitchFiles();
    }
  }, [fidoVaultKey, selectedFileIdentityKey, stitchFiles]);

  useEffect(() => {
    if (!selectedFileIdentityKey) return;
    if (lastAutoStitchKeyRef.current === selectedFileIdentityKey) return;
    if (
      lastAutoStitchKeyRef.current === null &&
      restoredSessionKeyRef.current === mountSeed.key
    ) {
      lastAutoStitchKeyRef.current = selectedFileIdentityKey;
      return;
    }
    lastAutoStitchKeyRef.current = selectedFileIdentityKey;
    void stitchFiles();
  }, [selectedFileIdentityKey, stitchFiles]);

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
    playIntegrityFailedFile,
  };
};

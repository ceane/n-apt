import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useAppDispatch } from "@n-apt/redux";
import {
  clearActivePlaybackMetadata,
  incrementPlaybackFrameCounter,
  setStitchStatus,
  setActivePlaybackMetadata,
} from "@n-apt/redux";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import { useStitchingLogic } from "@n-apt/hooks/useStitchingLogic";
import { usePlaybackAnimation } from "@n-apt/hooks/usePlaybackAnimation";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

interface DemodFilePlaybackBridgeProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  stitchTrigger: number | null;
  stitchSourceSettings: { gain: number; ppm: number };
  isPaused: boolean;
  fftSize: number;
  onStitchStatus?: (status: string) => void;
}

export const DemodFilePlaybackBridge: React.FC<DemodFilePlaybackBridgeProps> = ({
  selectedFiles,
  stitchTrigger,
  stitchSourceSettings,
  isPaused,
  fftSize,
  onStitchStatus,
}) => {
  const dispatch = useAppDispatch();
  const playbackDataRef = liveDataRef as React.MutableRefObject<LiveFrameData | null>;

  const {
    hasStitchedData,
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
    onStitchStatus: (status) => {
      dispatch(setStitchStatus(status));
      onStitchStatus?.(status);
    },
  });

  usePlaybackAnimation({
    hasStitchedData,
    isPaused,
    activeChannel,
    allChannelsRef,
    precomputedFrames,
    fftCanvasDataRef: playbackDataRef,
    displayMode: "iq",
    onFrameEmitted: () => {
      dispatch(incrementPlaybackFrameCounter());
    },
  });

  useLayoutEffect(() => {
    const channel = allChannelsRef.current[activeChannel];
    if (!channel) return;

    const activeRange =
      Array.isArray(channel.frequency_range) &&
      channel.frequency_range.length === 2 &&
      Number.isFinite(channel.frequency_range[0]) &&
      Number.isFinite(channel.frequency_range[1])
        ? channel.frequency_range
        : undefined;

    dispatch(
      setActivePlaybackMetadata({
        activeChannel,
        channelCount,
        center_frequency_hz: activeRange
          ? ((activeRange[0] + activeRange[1]) / 2)
          : channel.center_freq_hz,
        capture_sample_rate_hz: activeRange
          ? (activeRange[1] - activeRange[0])
          : channel.sample_rate_hz,
        frame_rate: channel.frame_rate,
        hardware_sample_rate_hz:
          channel.hardware_sample_rate_hz ?? hardwareSampleRateHz,
        frequency_range: activeRange,
      }),
    );
  }, [activeChannel, allChannelsRef, channelCount, dispatch, hardwareSampleRateHz]);

  const fileNamesSet = useMemo(
    () => new Set(selectedFiles.map((file) => file.name)),
    [selectedFiles],
  );
  const previousFileNamesRef = useRef<string>("");

  useEffect(() => {
    const nameKey = Array.from(fileNamesSet).sort().join("|");
    if (nameKey === previousFileNamesRef.current) return;
    previousFileNamesRef.current = nameKey;

    playbackDataRef.current = null;
    setChannelCount(0);
    setActiveChannel(0);
    dispatch(clearActivePlaybackMetadata());
    workerFileDataCache.current = [];
    workerFreqMap.current = [];
    workerMetadataMap.current = [];
    precomputedFrames.current = [];
    allChannelsRef.current = [];
  }, [
    allChannelsRef,
    dispatch,
    fileNamesSet,
    playbackDataRef,
    precomputedFrames,
    setActiveChannel,
    setChannelCount,
    workerFileDataCache,
    workerFreqMap,
    workerMetadataMap,
  ]);

  useEffect(() => {
    if (hasStitchedData) return;

    playbackDataRef.current = null;
    dispatch(clearActivePlaybackMetadata());
  }, [dispatch, hasStitchedData, playbackDataRef]);

  useEffect(() => {
    const channel = allChannelsRef.current[activeChannel] ?? allChannelsRef.current[0];
    if (!channel) return;

    const activeRange =
      Array.isArray(channel.frequency_range) &&
      channel.frequency_range.length === 2 &&
      Number.isFinite(channel.frequency_range[0]) &&
      Number.isFinite(channel.frequency_range[1])
        ? channel.frequency_range
        : null;

    if (activeRange) {
      setFrequencyRange({ min: activeRange[0], max: activeRange[1] });
      return;
    }

    const span = channel.sample_rate_hz || 3_200_000;
    const center = channel.center_freq_hz || 0;
    setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
  }, [activeChannel, allChannelsRef, setFrequencyRange]);

  useEffect(() => {
    return () => {
      playbackDataRef.current = null;
      workerFileDataCache.current = [];
      workerFreqMap.current = [];
      workerMetadataMap.current = [];
      precomputedFrames.current = [];
      allChannelsRef.current = [];
      dispatch(clearActivePlaybackMetadata());
    };
  }, [
    allChannelsRef,
    dispatch,
    playbackDataRef,
    precomputedFrames,
    workerFileDataCache,
    workerFreqMap,
    workerMetadataMap,
  ]);

  return null;
};

export default DemodFilePlaybackBridge;

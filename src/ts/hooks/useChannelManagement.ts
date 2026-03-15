import { useCallback } from "react";

interface UseChannelManagementProps {
  allChannelsRef: React.MutableRefObject<any[]>;
  setActiveChannel: (channel: number) => void;
  setFrequencyRange: (range: { min: number; max: number }) => void;
  onChannelMetadataChange?: (meta: {
    activeChannel: number;
    channelCount: number;
    center_frequency_hz?: number;
    capture_sample_rate_hz?: number;
    frame_rate?: number;
    hardware_sample_rate_hz?: number;
    frequency_range?: [number, number];
  }) => void;
}

export const useChannelManagement = ({
  allChannelsRef,
  setActiveChannel,
  setFrequencyRange,
  onChannelMetadataChange,
}: UseChannelManagementProps) => {
  // Channel switching helper - batches state updates for better performance
  const switchChannel = useCallback((newIdx: number) => {
    const ch = allChannelsRef.current[newIdx];
    if (!ch) return;

    setActiveChannel(newIdx);
    const freqRange =
      Array.isArray(ch.frequency_range) &&
      ch.frequency_range.length === 2 &&
      Number.isFinite(ch.frequency_range[0]) &&
      Number.isFinite(ch.frequency_range[1])
        ? ch.frequency_range
        : undefined;
    const derivedCenterHz = freqRange
      ? ((freqRange[0] + freqRange[1]) / 2) * 1_000_000
      : ch.center_freq_hz;
    const derivedCaptureRateHz = freqRange
      ? (freqRange[1] - freqRange[0]) * 1_000_000
      : ch.sample_rate_hz;
    onChannelMetadataChange?.({
      activeChannel: newIdx,
      channelCount: allChannelsRef.current.length,
      center_frequency_hz: derivedCenterHz,
      capture_sample_rate_hz: derivedCaptureRateHz,
      frame_rate: ch.frame_rate,
      hardware_sample_rate_hz: ch.hardware_sample_rate_hz,
      frequency_range: freqRange,
    });
    if (freqRange) {
      setFrequencyRange({
        min: freqRange[0],
        max: freqRange[1],
      });
      return;
    }

    const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
    const center = (ch.center_freq_hz || 0) / 1_000_000;
    setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
  }, [setActiveChannel, setFrequencyRange, onChannelMetadataChange, allChannelsRef]);

  return { switchChannel };
};

import { useCallback } from "react";
import {
  useAppDispatch,
  setSignalAreaAndRange,
  tuneToChannels,
} from "@n-apt/redux";
import { useOptionalSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";

export interface ChannelDescriptor {
  label: string;
  min: number;
  max: number;
  targetSampleRate?: number;
}

export const useChannelTuner = (
  onSampleRateChange?: (rate: number, mode?: "whole" | "manual") => void,
) => {
  const reduxDispatch = useAppDispatch();
  const spectrumStore = useOptionalSpectrumStore();

  const tuneChannels = useCallback(
    (
      channels: ChannelDescriptor[],
      selectedLabels?: string[],
      rangeOverride?: { min: number; max: number },
      sampleRateOverride?: number,
    ) => {
      if (!channels || channels.length === 0) return;

      const primary = channels[0];
      const primaryMin = primary.min;
      const primaryMax = primary.max;
      const range = rangeOverride ?? { min: primaryMin, max: primaryMax };
      const primaryLabel = primary.label.toUpperCase();

      reduxDispatch(tuneToChannels({ channels, selectedLabels }));
      reduxDispatch(
        setSignalAreaAndRange({
          area: primaryLabel,
          range,
        }),
      );

      const targetSampleRate = sampleRateOverride ?? primary.targetSampleRate;
      if (
        typeof targetSampleRate === "number" &&
        Number.isFinite(targetSampleRate) &&
        targetSampleRate > 0
      ) {
        onSampleRateChange?.(targetSampleRate, "whole");
      }

      if (spectrumStore) {
        spectrumStore.wsConnection?.sendFrequencyRange?.(range);
      }
    },
    [reduxDispatch, spectrumStore, onSampleRateChange],
  );

  return { tuneChannels };
};

interface UseChannelManagementProps {
  allChannelsRef: React.MutableRefObject<any[]>;
  setActiveChannel: (channel: number) => void;
  setFrequencyRange: (range: { min: number; max: number }) => void;
  onChannelMetadataChange?: (meta: {
    activeChannel: number;
    channelCount: number;
    channelLabel?: string;
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
  const { tuneChannels } = useChannelTuner();

  // Channel switching helper - batches state updates for better performance
  const switchChannel = useCallback(
    (newIdx: number) => {
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
        ? (freqRange[0] + freqRange[1]) / 2
        : ch.center_freq_hz;
      const derivedCaptureRateHz = freqRange
        ? freqRange[1] - freqRange[0]
        : ch.sample_rate_hz;
      const channelLabel = ch.label || `Channel ${newIdx + 1}`;
      onChannelMetadataChange?.({
        activeChannel: newIdx,
        channelCount: allChannelsRef.current.length,
        channelLabel,
        center_frequency_hz: derivedCenterHz,
        capture_sample_rate_hz: derivedCaptureRateHz,
        frame_rate: ch.frame_rate,
        hardware_sample_rate_hz: ch.hardware_sample_rate_hz,
        frequency_range: freqRange,
      });

      if (freqRange) {
        tuneChannels(
          [{ label: channelLabel, min: freqRange[0], max: freqRange[1] }],
          undefined,
          undefined,
          derivedCaptureRateHz,
        );
        return;
      }

      const span = ch.sample_rate_hz || 3_200_000;
      const center = ch.center_freq_hz || 0;
      const min = center - span / 2;
      const max = center + span / 2;
      tuneChannels([{ label: channelLabel, min, max }]);
    },
    [
      setActiveChannel,
      onChannelMetadataChange,
      allChannelsRef,
      tuneChannels,
    ],
  );

  return { switchChannel };
};

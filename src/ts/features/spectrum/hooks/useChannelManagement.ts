import { useCallback, useEffect, useRef } from "react";
import {
  useAppDispatch,
  useAppSelector,
  setSignalAreaAndRange,
  setFrequencyRange,
  setVizPan,
  setTuningPreviewActive,
  tuneToChannels,
} from "@n-apt/redux";
import { useOptionalSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import {
  createProgressiveTuningController,
  resolveTuningRange,
  type ProgressiveTuningController,
  type TuneOptions,
  type TuningFrequencyRange,
} from "@n-apt/spectrum/tuning/progressiveTuning";

export type { TuneInertia, TuneOptions, TuneWiggleOptions } from "@n-apt/spectrum/tuning/progressiveTuning";

export interface ChannelDescriptor {
  label: string;
  min: number;
  max: number;
  targetSampleRate?: number;
}

export const useChannelTuner = (
  onSampleRateChange?: (
    rate: number,
    mode?: "whole" | "manual",
    channelFocusRange?: TuningFrequencyRange,
  ) => void,
) => {
  const reduxDispatch = useAppDispatch();
  const spectrumStore = useOptionalSpectrumStore();
  const reduxDispatchRef = useRef(reduxDispatch);
  reduxDispatchRef.current = reduxDispatch;
  const spectrumStoreRef = useRef(spectrumStore);
  spectrumStoreRef.current = spectrumStore;
  const tuningPreviewActive = useAppSelector(
    (state) => state.spectrum.tuningPreviewActive,
  );
  const previewRangeRef = useRef<TuningFrequencyRange | null>(null);
  const activeTuneRef = useRef<{ area: string } | null>(null);
  const progressiveControllerRef = useRef<ProgressiveTuningController | null>(
    null,
  );

  if (!progressiveControllerRef.current) {
    progressiveControllerRef.current = createProgressiveTuningController({
      onPreview: (range) => {
        previewRangeRef.current = range;
        reduxDispatchRef.current(setFrequencyRange(range));
      },
      onRetune: (range) => {
        spectrumStoreRef.current?.wsConnection?.sendFrequencyRange?.(range);
      },
      onComplete: (range) => {
        const activeTune = activeTuneRef.current;
        if (!activeTune) return;
        reduxDispatchRef.current(
          setSignalAreaAndRange({ area: activeTune.area, range }),
        );
        reduxDispatchRef.current(setTuningPreviewActive(false));
        previewRangeRef.current = null;
        activeTuneRef.current = null;
      },
    });
  }

  useEffect(
    () => () => {
      progressiveControllerRef.current?.cancel();
      if (activeTuneRef.current) {
        reduxDispatchRef.current(setTuningPreviewActive(false));
        activeTuneRef.current = null;
        previewRangeRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (tuningPreviewActive || !activeTuneRef.current) return;
    progressiveControllerRef.current?.cancel();
    activeTuneRef.current = null;
    previewRangeRef.current = null;
  }, [tuningPreviewActive]);

  const tuneChannels = useCallback(
    (
      channels: ChannelDescriptor[],
      selectedLabels?: string[],
      rangeOverride?: { min: number; max: number },
      sampleRateOverride?: number,
      tuneOptions?: TuneOptions,
    ) => {
      if (!channels || channels.length === 0) return;

      const primary = channels[0];
      const primaryMin = primary.min;
      const primaryMax = primary.max;
      const range = rangeOverride ?? { min: primaryMin, max: primaryMax };
      const primaryLabel = primary.label.toUpperCase();

      const targetBounds =
        spectrumStoreRef.current?.signalAreaBounds?.[primaryLabel] ??
        spectrumStoreRef.current?.signalAreaBounds?.[primary.label] ?? {
          min: primaryMin,
          max: primaryMax,
        };

      if (tuneOptions) {
        const targetRange = resolveTuningRange(
          (range.min + range.max) / 2,
          range,
          targetBounds,
        );
        const fromRange =
          previewRangeRef.current ??
          spectrumStoreRef.current?.state.frequencyRange ??
          targetRange;

        activeTuneRef.current = { area: primaryLabel };
        reduxDispatch(setTuningPreviewActive(true));
        // Commit the requested acquisition window immediately. The animation
        // then updates the preview range while the device catches up, so
        // callers that need a synchronous tune still receive one coherent
        // device-range command.
        reduxDispatch(
          setSignalAreaAndRange({ area: primaryLabel, range }),
        );
        reduxDispatch(
          tuneToChannels({
            channels,
            selectedLabels,
            frequencyRange: fromRange,
          }),
        );
        reduxDispatch(setVizPan(0));

        const targetSampleRate = sampleRateOverride ?? primary.targetSampleRate;
        if (
          typeof targetSampleRate === "number" &&
          Number.isFinite(targetSampleRate) &&
          targetSampleRate > 0
        ) {
          onSampleRateChange?.(targetSampleRate, "whole", range);
        }

        spectrumStoreRef.current?.wsConnection?.sendFrequencyRange?.(range);

        progressiveControllerRef.current?.start(
          fromRange,
          targetRange,
          tuneOptions,
          targetBounds,
        );
        return;
      }

      // An immediate tune is also a latest-wins operation. This matters when
      // a user clicks a channel while an animated tune is still in flight.
      if (activeTuneRef.current) {
        progressiveControllerRef.current?.cancel();
        activeTuneRef.current = null;
        previewRangeRef.current = null;
        reduxDispatch(setTuningPreviewActive(false));
      }

      reduxDispatch(tuneToChannels({ channels, selectedLabels }));
      reduxDispatch(
        setSignalAreaAndRange({
          area: primaryLabel,
          range,
        }),
      );
      // A channel tune establishes a new positive acquisition window. Any
      // pan from the previously selected channel is display-relative state
      // and would otherwise place the new source off-screen (often leaving a
      // floor-only frame until the user manually pans back).
      reduxDispatch(setVizPan(0));

      const targetSampleRate = sampleRateOverride ?? primary.targetSampleRate;
      if (
        typeof targetSampleRate === "number" &&
        Number.isFinite(targetSampleRate) &&
        targetSampleRate > 0
      ) {
        onSampleRateChange?.(targetSampleRate, "whole", range);
      }

      if (spectrumStore) {
        spectrumStore.wsConnection?.sendFrequencyRange?.(range);
      }
    },
    [reduxDispatch, onSampleRateChange],
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
  setFrequencyRange: _setFrequencyRange,
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

import { useEffect, useRef } from "react";
import {
  resolveDemodChannelSelectionAndRange,
  type DemodChannelRange,
  type DemodChannelSelectionAndRange,
} from "@n-apt/demodulation/channelPrerequisites";

type InitialDemodTuneOptions = {
  isConnected: boolean;
  activeSourceId: string | null | undefined;
  sourceMode: string | undefined;
  channels: Parameters<typeof resolveDemodChannelSelectionAndRange>[2];
  sampleRateHz: number;
  activeSignalArea: string | null | undefined;
  frequencyRange: DemodChannelRange | null | undefined;
  onTune: (selection: DemodChannelSelectionAndRange) => void;
};

/** Initialize the live route once, then leave subsequent tuning to the user. */
export const useInitialDemodTune = ({
  isConnected,
  activeSourceId,
  sourceMode,
  channels,
  sampleRateHz,
  activeSignalArea,
  frequencyRange,
  onTune,
}: InitialDemodTuneOptions): void => {
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !isConnected || !activeSourceId || sourceMode !== "live" || !channels?.length) return;
    const selection = resolveDemodChannelSelectionAndRange("A", null, channels, sampleRateHz);
    if (!selection) return;
    initialized.current = true;
    const alreadyTuned = activeSignalArea?.trim().toUpperCase() === selection.channelLabel &&
      selection.range.min === frequencyRange?.min && selection.range.max === frequencyRange?.max;
    if (!alreadyTuned) onTune(selection);
  }, [isConnected, activeSourceId, sourceMode, channels, sampleRateHz, activeSignalArea, frequencyRange, onTune]);
};

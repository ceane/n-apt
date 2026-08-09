import { useMemo } from "react";
import type { FrequencyRange } from "@n-apt/consts/types";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";

export interface SpectrumTransportCommands {
  sendFrequencyRange: (range: FrequencyRange) => void;
  sendPauseCommand: (isPaused: boolean, sourceId: string) => void;
  sendPowerScaleCommand: (scale: "dB" | "dBm") => void;
}

/**
 * Keep transport commands behind a small API while the provider is migrated.
 * State and device metadata intentionally do not cross this boundary.
 */
export const createSpectrumTransport = (
  commands: SpectrumTransportCommands,
): SpectrumTransportCommands => commands;

export const useSpectrumTransport = (): SpectrumTransportCommands => {
  const { wsConnection } = useSpectrumStore();

  return useMemo(
    () =>
      createSpectrumTransport({
        sendFrequencyRange: wsConnection.sendFrequencyRange,
        sendPauseCommand: wsConnection.sendPauseCommand,
        sendPowerScaleCommand: wsConnection.sendPowerScaleCommand,
      }),
    [
      wsConnection.sendFrequencyRange,
      wsConnection.sendPauseCommand,
      wsConnection.sendPowerScaleCommand,
    ],
  );
};

import { useEffect, useRef } from "react";
import type { Dispatch } from "react";

interface UseDeviceConnectionStateOptions {
  deviceState: string;
  showSpikeOverlay: boolean;
  dispatch: Dispatch<any>;
}

/**
 * Hook for managing UI state based on device connection status
 * Handles spike-overlay state.
 */
export const useDeviceConnectionState = ({
  deviceState,
  showSpikeOverlay,
  dispatch,
}: UseDeviceConnectionStateOptions) => {
  const lastUnavailableStateRef = useRef<{
    deviceState: string;
    showSpikeOverlay: boolean;
  } | null>(null);

  useEffect(() => {
    if (
      deviceState === "connected" ||
      deviceState === "receiving" ||
      deviceState === "paused" ||
      deviceState === "streaming"
    ) {
      lastUnavailableStateRef.current = null;
      return;
    }

    const lastUnavailableState = lastUnavailableStateRef.current;
    if (
      lastUnavailableState &&
      lastUnavailableState.deviceState === deviceState &&
      lastUnavailableState.showSpikeOverlay === showSpikeOverlay
    ) {
      return;
    }

    lastUnavailableStateRef.current = { deviceState, showSpikeOverlay };

    if (
      deviceState !== "connected" &&
      deviceState !== "receiving" &&
      deviceState !== "paused" &&
      deviceState !== "streaming" &&
      showSpikeOverlay
    ) {
      dispatch({ type: "SET_SHOW_SPIKE_OVERLAY", enabled: false });
    }
  }, [deviceState, showSpikeOverlay, dispatch]);
};

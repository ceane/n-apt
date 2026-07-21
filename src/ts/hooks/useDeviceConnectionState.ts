import { useEffect, useRef } from "react";
import type { Dispatch } from "react";

interface UseDeviceConnectionStateOptions {
  deviceState: string;
  showSpikeOverlay: boolean;
  dispatch: Dispatch<any>;
}

/**
 * Hook for managing UI state based on device connection status
 * Handles spike overlay and heterodyning verification states
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
    if (deviceState === "connected" || deviceState === "streaming") {
      lastUnavailableStateRef.current = null;
      dispatch({ type: "SET_HETERODYNING_VERIFY_DISABLED", disabled: false });
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
      deviceState !== "streaming" &&
      showSpikeOverlay
    ) {
      dispatch({ type: "SET_SHOW_SPIKE_OVERLAY", enabled: false });
    }
    dispatch({ type: "SET_HETERODYNING_VERIFY_DISABLED", disabled: true });
    dispatch({
      type: "SET_HETERODYNING_RESULT",
      detected: false,
      confidence: null,
      statusText: "Unavailable",
      highlightedBins: [],
    });
  }, [deviceState, showSpikeOverlay, dispatch]);
};

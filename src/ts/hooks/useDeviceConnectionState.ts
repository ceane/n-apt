import { useEffect } from "react";
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
  useEffect(() => {
    if (deviceState !== "connected" && showSpikeOverlay) {
      dispatch({ type: "SET_SHOW_SPIKE_OVERLAY", enabled: false });
    }
    if (deviceState !== "connected") {
      dispatch({ type: "SET_HETERODYNING_VERIFY_DISABLED", disabled: true });
      dispatch({
        type: "SET_HETERODYNING_RESULT",
        detected: false,
        confidence: null,
        statusText: "Unavailable",
        highlightedBins: [],
      });
    } else {
      dispatch({ type: "SET_HETERODYNING_VERIFY_DISABLED", disabled: false });
    }
  }, [deviceState, showSpikeOverlay, dispatch]);
};

import { useMemo } from "react";
import { useDemod } from "@n-apt/contexts/DemodContext";
import {
  DEMOD_MIN_FFT_SIZE,
  DEMOD_REQUIRED_TEMPORAL_RESOLUTION,
  hasConnectedDemodQualityNode,
} from "@n-apt/utils/demodQuality";

export const useDemodQualityGuard = () => {
  const { nodes, edges } = useDemod();

  return useMemo(() => {
    const isLocked = hasConnectedDemodQualityNode(nodes, edges);

    return {
      isLocked,
      minimumFftSize: DEMOD_MIN_FFT_SIZE,
      requiredTemporalResolution: DEMOD_REQUIRED_TEMPORAL_RESOLUTION,
    };
  }, [edges, nodes]);
};

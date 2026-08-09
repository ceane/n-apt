import { useMemo } from "react";
import { useDemodFlow } from "@n-apt/demodulation/context/DemodFlowContext";
import {
  DEMOD_MIN_FFT_SIZE,
  DEMOD_REQUIRED_TEMPORAL_RESOLUTION,
  hasConnectedDemodQualityNode,
} from "@n-apt/demodulation/utils/demodQuality";

export const useDemodQualityGuard = () => {
  const { nodes, edges } = useDemodFlow();

  return useMemo(() => {
    const isLocked = hasConnectedDemodQualityNode(nodes, edges);

    return {
      isLocked,
      minimumFftSize: DEMOD_MIN_FFT_SIZE,
      requiredTemporalResolution: DEMOD_REQUIRED_TEMPORAL_RESOLUTION,
    };
  }, [edges, nodes]);
};

import { createContext, useContext } from "react";
import type { AnalysisSession } from "@n-apt/consts/types";

export interface DemodAnalysisContextValue {
  analysisSession: AnalysisSession;
}

export interface DemodCaptureCountdownValue {
  countdown?: number;
}

export const DemodAnalysisContext = createContext<DemodAnalysisContextValue | null>(
  null,
);

const DemodCaptureCountdownContext = createContext<DemodCaptureCountdownValue>(
  {},
);

export const useDemodAnalysis = () => {
  const context = useContext(DemodAnalysisContext);
  if (!context) {
    throw new Error(
      "useDemodAnalysis must be used within a DemodProvider",
    );
  }
  return context;
};

export const DemodCaptureCountdownProvider = DemodCaptureCountdownContext.Provider;

export const useDemodCaptureCountdown = (): DemodCaptureCountdownValue =>
  useContext(DemodCaptureCountdownContext);

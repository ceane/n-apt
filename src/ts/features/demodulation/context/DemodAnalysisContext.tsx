import { createContext, useContext } from "react";
import type { AnalysisSession } from "@n-apt/consts/types";

export interface DemodAnalysisContextValue {
  analysisSession: AnalysisSession;
}

export const DemodAnalysisContext = createContext<DemodAnalysisContextValue | null>(
  null,
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

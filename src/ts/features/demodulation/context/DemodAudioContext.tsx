import { createContext, useContext } from "react";
import type { AudioPlaybackHandle } from "@n-apt/demodulation/hooks/useAudioExtraction";

export interface DemodAudioContextValue {
  audioPlayback: AudioPlaybackHandle;
}

export const DemodAudioContext = createContext<DemodAudioContextValue | null>(
  null,
);

export const useDemodAudio = () => {
  const context = useContext(DemodAudioContext);
  if (!context) {
    throw new Error("useDemodAudio must be used within a DemodProvider");
  }
  return context;
};

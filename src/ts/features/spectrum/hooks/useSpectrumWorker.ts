import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { SpectrumWorkerClient, type SpectrumWorkerConfig } from "../fft/spectrumWorkerClient";
import { createSpectrumWorker } from "../fft/spectrumWorkerFactory";

export function useSpectrumWorker() {
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const client = useRef<SpectrumWorkerClient | null>(null);
  useEffect(() => {
    const worker = createSpectrumWorker();
    if (worker) client.current = new SpectrumWorkerClient(worker);
    else setFallbackRequired(true);
    return () => { client.current?.dispose(); client.current = null; };
  }, []);
  const readSpectrum = useCallback((frame: LiveFrameData, config: SpectrumWorkerConfig) => {
    const result = client.current?.read(frame, config);
    if (result === undefined) setFallbackRequired(true);
    return result;
  }, []);
  return { readSpectrum, fallbackRequired };
}

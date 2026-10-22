import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { subscribeFrameArrivals } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  SpectrumWorkerClient,
  type SpectrumWorkerConfig,
  type SpectrumWorkerResult,
} from "../fft/spectrumWorkerClient";
import { createSpectrumWorker } from "../fft/spectrumWorkerFactory";

type SpectrumWorkerOptions = {
  frameRef: { current: LiveFrameData | LiveFrameData[] | null };
  config: SpectrumWorkerConfig;
  onSpectrumReady?: () => void;
};

const latestFrame = (value: LiveFrameData | LiveFrameData[] | null) =>
  Array.isArray(value) ? value[value.length - 1] ?? null : value;

export function useSpectrumWorker(options: SpectrumWorkerOptions) {
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const client = useRef<SpectrumWorkerClient | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const submitLatest = useCallback(() => {
    const { frameRef, config } = optionsRef.current;
    const frame = latestFrame(frameRef.current);
    if (frame?.iq_data && frame.iq_data.length >= 2) {
      client.current?.submit(frame, config);
    }
  }, []);

  useEffect(() => {
    const worker = createSpectrumWorker();
    if (!worker) {
      setFallbackRequired(true);
      return;
    }
    client.current = new SpectrumWorkerClient(
      worker,
      () => optionsRef.current.onSpectrumReady?.(),
      () => setFallbackRequired(true),
    );
    const unsubscribe = subscribeFrameArrivals(submitLatest);
    submitLatest();
    return () => {
      unsubscribe();
      client.current?.dispose();
      client.current = null;
    };
  }, [submitLatest]);

  useEffect(() => {
    // Reprocess the resident frame after an FFT option changes.
    submitLatest();
  }, [options.config.fftSize, options.config.offsetDb, options.config.windowType, submitLatest]);

  const readSpectrum = useCallback((
    frame: LiveFrameData,
    config: SpectrumWorkerConfig,
  ): SpectrumWorkerResult | null | undefined => {
    if (!client.current) return fallbackRequired ? undefined : null;
    const result = client.current.read(frame, config);
    if (result === undefined) setFallbackRequired(true);
    return result;
  }, [fallbackRequired]);

  return { readSpectrum, fallbackRequired };
}

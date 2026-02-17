import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { SDRSettings } from "@n-apt/hooks/useWebSocket";

interface UseSdrSettingsProps {
  maxSampleRate: number;
  onSettingsChange?: (settings: SDRSettings) => void;
}

interface UseSdrSettingsReturn {
  fftSize: number;
  fftWindow: string;
  fftFrameRate: number;
  maxFrameRate: number;
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  fftSizeOptions: number[];
  clampGain: (val: number) => number;
  setFftSize: (size: number) => void;
  setFftWindow: (window: string) => void;
  setFftFrameRate: (rate: number) => void;
  setGain: (gain: number) => void;
  setPpm: (ppm: number) => void;
  setTunerAGC: (enabled: boolean) => void;
  setRtlAGC: (enabled: boolean) => void;
  sendCurrentSettings: (overrides?: Partial<SDRSettings>) => void;
  scheduleCoupledAdjustment: (trigger: "fftSize" | "frameRate", fftSize: number, frameRate: number) => void;
}

export const useSdrSettings = ({ maxSampleRate, onSettingsChange }: UseSdrSettingsProps): UseSdrSettingsReturn => {
  // FFT settings defaults tuned for realistic 3.2 Msps RTL-SDR throughput
  const [fftSize, setFftSize] = useState(32768);
  const [fftWindow, setFftWindow] = useState("Rectangular");

  // Calculate logical max frame rate based on FFT size and sample rate
  const maxFrameRate = useMemo(() => {
    const theoretical = maxSampleRate / fftSize;
    return Math.max(1, Math.floor(Math.min(theoretical, 60))); // Cap at 60Hz screen refresh rate
  }, [fftSize, maxSampleRate]);

  // Set frame rate to logical max on mount/update
  const [fftFrameRate, setFftFrameRate] = useState(() => {
    const theoretical = maxSampleRate / 32768; // Default sample rate / FFT size
    return Math.max(1, Math.floor(Math.min(theoretical, 60)));
  });

  // Device settings
  const [gain, setGain] = useState(49.6);
  const [tunerAGC, setTunerAGC] = useState(false);
  const [rtlAGC, setRtlAGC] = useState(false);
  const [ppm, setPpm] = useState(1);

  const clampGain = useCallback((val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(49.6, val));
  }, []);

  // Helper to send settings on any control change
  const sendCurrentSettings = useCallback(
    (overrides: Partial<SDRSettings> = {}) => {
      onSettingsChange?.({
        fftSize,
        fftWindow,
        frameRate: fftFrameRate,
        gain,
        ppm,
        tunerAGC,
        rtlAGC,
        ...overrides,
      });
    },
    [fftSize, fftWindow, fftFrameRate, gain, ppm, tunerAGC, rtlAGC, onSettingsChange],
  );

  const fftSizeOptions = useMemo(() => [8192, 16384, 32768, 65536, 131072, 262144], []);
  const couplingTimerRef = useRef<number | null>(null);

  const scheduleCoupledAdjustment = useCallback(
    (trigger: "fftSize" | "frameRate", nextFftSize: number, nextFrameRate: number) => {
      if (couplingTimerRef.current !== null) {
        window.clearTimeout(couplingTimerRef.current);
      }

      couplingTimerRef.current = window.setTimeout(() => {
        couplingTimerRef.current = null;

        if (trigger === "fftSize") {
          const theoreticalMax = maxSampleRate / nextFftSize;
          const desiredFrameRate = Math.max(1, Math.floor(Math.min(theoreticalMax, 60)));
          if (desiredFrameRate !== nextFrameRate) {
            setFftFrameRate(desiredFrameRate);
            sendCurrentSettings({ frameRate: desiredFrameRate });
          }
          return;
        }

        const maxFftSizeForRate = Math.floor(maxSampleRate / Math.max(1, nextFrameRate));
        let desiredFftSize = fftSizeOptions[0];
        for (const size of fftSizeOptions) {
          if (size <= maxFftSizeForRate) desiredFftSize = size;
          else break;
        }

        if (desiredFftSize !== nextFftSize) {
          setFftSize(desiredFftSize);
          sendCurrentSettings({ fftSize: desiredFftSize });
        }
      }, 300);
    },
    [fftSizeOptions, maxSampleRate, sendCurrentSettings],
  );

  useEffect(() => {
    return () => {
      if (couplingTimerRef.current !== null) {
        window.clearTimeout(couplingTimerRef.current);
        couplingTimerRef.current = null;
      }
    };
  }, []);

  // Update frame rate to logical max when FFT size or sample rate changes
  useEffect(() => {
    setFftFrameRate(maxFrameRate);
  }, [maxFrameRate]);

  // Send initial settings on mount when connected
  const initialSettingsSent = useRef(false);
  useEffect(() => {
    if (!initialSettingsSent.current && onSettingsChange) {
      initialSettingsSent.current = true;
      sendCurrentSettings();
    }
  }, [sendCurrentSettings, onSettingsChange]);

  return {
    fftSize,
    fftWindow,
    fftFrameRate,
    maxFrameRate,
    gain,
    ppm,
    tunerAGC,
    rtlAGC,
    fftSizeOptions,
    clampGain,
    setFftSize,
    setFftWindow,
    setFftFrameRate,
    setGain,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    sendCurrentSettings,
    scheduleCoupledAdjustment,
  };
};

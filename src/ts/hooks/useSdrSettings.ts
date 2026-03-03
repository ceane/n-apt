import { useCallback, useMemo, useRef, useEffect } from "react";
import type { SDRSettings, SdrSettingsConfig } from "@n-apt/hooks/useWebSocket";
import {
  useSpectrumStore,
  type SpectrumState,
} from "@n-apt/hooks/useSpectrumStore";

interface UseSdrSettingsProps {
  maxSampleRate: number;
  sdrSettings?: SdrSettingsConfig | null;
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
  scheduleCoupledAdjustment: (
    trigger: "fftSize" | "frameRate",
    fftSize: number,
    frameRate: number,
  ) => void;
}

export const computeMaxFrameRate = (
  maxSampleRate: number,
  fftSize: number,
  maxFrameRateLimit?: number,
): number => {
  if (!fftSize) return 0;
  const theoretical = maxSampleRate / fftSize;
  const limit =
    typeof maxFrameRateLimit === "number" ? maxFrameRateLimit : theoretical;
  return Math.max(1, Math.floor(Math.min(theoretical, limit)));
};

export const deriveStateFromConfig = (
  maxSampleRate: number,
  sdrSettings?: SdrSettingsConfig | null,
): Partial<SpectrumState> => {
  const fft = sdrSettings?.fft;
  const gainConfig = sdrSettings?.gain;
  const fftSize = typeof fft?.default_size === "number" ? fft.default_size : 0;
  const maxFrameRate = computeMaxFrameRate(
    maxSampleRate,
    fftSize,
    fft?.max_frame_rate,
  );
  const rawFrameRate =
    typeof fft?.default_frame_rate === "number"
      ? fft.default_frame_rate
      : maxFrameRate;

  return {
    fftSize,
    fftWindow: "Rectangular",
    fftFrameRate: maxFrameRate
      ? Math.min(rawFrameRate, maxFrameRate)
      : rawFrameRate,
    gain:
      typeof gainConfig?.tuner_gain === "number" ? gainConfig.tuner_gain : 0,
    tunerAGC: gainConfig?.tuner_agc ?? false,
    rtlAGC: gainConfig?.rtl_agc ?? false,
    ppm: typeof sdrSettings?.ppm === "number" ? sdrSettings.ppm : 0,
  };
};

export const useSdrSettings = ({
  maxSampleRate,
  sdrSettings,
  onSettingsChange,
}: UseSdrSettingsProps): UseSdrSettingsReturn => {
  const { state, dispatch } = useSpectrumStore();

  const maxFrameRate = useMemo(() => {
    return computeMaxFrameRate(
      maxSampleRate,
      state.fftSize,
      sdrSettings?.fft?.max_frame_rate,
    );
  }, [maxSampleRate, state.fftSize, sdrSettings]);

  const stateRef = useRef(state);
  const onSettingsChangeRef = useRef(onSettingsChange);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);

  const sendCurrentSettings = useCallback(
    (overrides: Partial<SDRSettings> = {}) => {
      onSettingsChangeRef.current?.({
        fftSize: stateRef.current.fftSize,
        fftWindow: stateRef.current.fftWindow,
        frameRate: stateRef.current.fftFrameRate,
        gain: stateRef.current.gain,
        ppm: stateRef.current.ppm,
        tunerAGC: stateRef.current.tunerAGC,
        rtlAGC: stateRef.current.rtlAGC,
        ...overrides,
      });
    },
    [],
  );

  const setFftSize = useCallback(
    (size: number) => {
      dispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: { fftSize: size },
      });
      sendCurrentSettings({ fftSize: size });
    },
    [dispatch, sendCurrentSettings],
  );
  const setFftWindow = useCallback(
    (window: string) => {
      dispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: { fftWindow: window },
      });
      sendCurrentSettings({ fftWindow: window });
    },
    [dispatch, sendCurrentSettings],
  );
  const setFftFrameRate = useCallback(
    (rate: number) => {
      dispatch({ type: "SET_FFT_FRAME_RATE", fftFrameRate: rate });
      sendCurrentSettings({ frameRate: rate });
    },
    [dispatch, sendCurrentSettings],
  );
  const setGain = useCallback(
    (gain: number) => {
      dispatch({ type: "SET_SDR_SETTINGS_BUNDLE", settings: { gain } });
      sendCurrentSettings({ gain });
    },
    [dispatch, sendCurrentSettings],
  );
  const setTunerAGC = useCallback(
    (enabled: boolean) => {
      dispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: { tunerAGC: enabled },
      });
      sendCurrentSettings({ tunerAGC: enabled });
    },
    [dispatch, sendCurrentSettings],
  );
  const setRtlAGC = useCallback(
    (enabled: boolean) => {
      dispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: { rtlAGC: enabled },
      });
      sendCurrentSettings({ rtlAGC: enabled });
    },
    [dispatch, sendCurrentSettings],
  );
  const setPpm = useCallback(
    (ppm: number) => {
      dispatch({ type: "SET_SDR_SETTINGS_BUNDLE", settings: { ppm } });
      sendCurrentSettings({ ppm });
    },
    [dispatch, sendCurrentSettings],
  );

  const clampGain = useCallback(
    (val: number) => {
      if (Number.isNaN(val)) return 0;
      const maxGain =
        typeof sdrSettings?.gain?.tuner_gain === "number"
          ? sdrSettings.gain.tuner_gain
          : undefined;
      if (typeof maxGain === "number") {
        return Math.max(0, Math.min(maxGain, val));
      }
      return val;
    },
    [sdrSettings],
  );

  const fftSizeOptions = useMemo(() => {
    const sizeMap = sdrSettings?.fft?.size_to_frame_rate;
    if (sizeMap) {
      return Object.keys(sizeMap)
        .map((key) => Number(key))
        .filter((size) => Number.isFinite(size))
        .sort((a, b) => a - b);
    }
    const fallback =
      typeof sdrSettings?.fft?.default_size === "number"
        ? [sdrSettings.fft.default_size]
        : [];
    return fallback;
  }, [sdrSettings]);
  const couplingTimerRef = useRef<number | null>(null);
  const skipFrameRateSyncRef = useRef(false);

  const scheduleCoupledAdjustment = useCallback(
    (
      trigger: "fftSize" | "frameRate",
      nextFftSize: number,
      nextFrameRate: number,
    ) => {
      if (couplingTimerRef.current !== null) {
        window.clearTimeout(couplingTimerRef.current);
      }

      couplingTimerRef.current = window.setTimeout(() => {
        couplingTimerRef.current = null;

        if (trigger === "fftSize") {
          const desiredFrameRate = computeMaxFrameRate(
            maxSampleRate,
            nextFftSize,
            sdrSettings?.fft?.max_frame_rate,
          );
          if (desiredFrameRate !== nextFrameRate) {
            setFftFrameRate(desiredFrameRate);
            sendCurrentSettings({ frameRate: desiredFrameRate });
          }
          return;
        }

        const maxFftSizeForRate = Math.floor(
          maxSampleRate / Math.max(1, nextFrameRate),
        );
        let desiredFftSize = fftSizeOptions[0];
        if (desiredFftSize === undefined) {
          return;
        }
        for (const size of fftSizeOptions) {
          if (size <= maxFftSizeForRate) desiredFftSize = size;
          else break;
        }

        if (desiredFftSize !== nextFftSize) {
          skipFrameRateSyncRef.current = true;
          setFftSize(desiredFftSize);
          sendCurrentSettings({ fftSize: desiredFftSize });
        }
      }, 300);
    },
    [
      fftSizeOptions,
      maxSampleRate,
      sdrSettings,
      sendCurrentSettings,
      setFftFrameRate,
      setFftSize,
    ],
  );

  useEffect(() => {
    return () => {
      if (couplingTimerRef.current !== null) {
        window.clearTimeout(couplingTimerRef.current);
        couplingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!maxFrameRate) return;
    if (skipFrameRateSyncRef.current) {
      skipFrameRateSyncRef.current = false;
      return;
    }
    if (stateRef.current.fftFrameRate > maxFrameRate) {
      setFftFrameRate(maxFrameRate);
    }
  }, [maxFrameRate, setFftFrameRate]);

  return {
    ...state,
    maxFrameRate,
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

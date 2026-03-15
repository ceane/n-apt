import { useCallback, useMemo, useRef, useEffect } from "react";
import type { SDRSettings, SdrSettingsConfig } from "@n-apt/hooks/useWebSocket";
import type { SpectrumState } from "@n-apt/hooks/useSpectrumStore";
import {
  useAppDispatch,
  useAppSelector,
  setSdrSettingsBundle,
  setFftFrameRate as setFftFrameRateAction,
} from "@n-apt/redux";

interface UseSdrSettingsProps {
  maxSampleRate: number;
  sdrSettings?: SdrSettingsConfig | null;
  onSettingsChange?: (settings: SDRSettings) => void;
  spectrumStateOverride?: Pick<
    SpectrumState,
    | "fftSize"
    | "fftWindow"
    | "fftFrameRate"
    | "gain"
    | "ppm"
    | "tunerAGC"
    | "rtlAGC"
  >;
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

const getLogicalSizeToFrameRate = (
  sdrSettings?: SdrSettingsConfig | null,
): Map<number, number> => {
  const sizeMap = sdrSettings?.fft?.size_to_frame_rate;
  if (!sizeMap) return new Map();

  return new Map(
    Object.entries(sizeMap)
      .map(([size, frameRate]) => [Number(size), Number(frameRate)] as const)
      .filter(
        ([size, frameRate]) =>
          Number.isFinite(size) &&
          size > 0 &&
          Number.isFinite(frameRate) &&
          frameRate > 0,
      )
      .sort((a, b) => a[0] - b[0]),
  );
};

export const getLogicalMaxFrameRate = (
  maxSampleRate: number,
  fftSize: number,
  sdrSettings?: SdrSettingsConfig | null,
): number => {
  const logicalMap = getLogicalSizeToFrameRate(sdrSettings);
  const mapped = logicalMap.get(fftSize);
  if (typeof mapped === "number") {
    return mapped;
  }

  return computeMaxFrameRate(
    maxSampleRate,
    fftSize,
    sdrSettings?.fft?.max_frame_rate,
  );
};

const getBestLogicalFftSizeForFrameRate = (
  requestedFrameRate: number,
  fftSizeOptions: number[],
  sdrSettings?: SdrSettingsConfig | null,
): number | null => {
  if (!fftSizeOptions.length) return null;

  const logicalMap = getLogicalSizeToFrameRate(sdrSettings);
  if (!logicalMap.size) {
    return null;
  }

  let bestSize = fftSizeOptions[0];
  for (const size of fftSizeOptions) {
    const supportedFrameRate = logicalMap.get(size);
    if (typeof supportedFrameRate !== "number") continue;
    if (supportedFrameRate >= requestedFrameRate) {
      bestSize = size;
    } else {
      break;
    }
  }

  return bestSize;
};

export const deriveStateFromConfig = (
  maxSampleRate: number,
  sdrSettings?: SdrSettingsConfig | null,
): Partial<SpectrumState> => {
  const fft = sdrSettings?.fft;
  const gainConfig = sdrSettings?.gain;
  const fftSize = typeof fft?.default_size === "number" ? fft.default_size : 0;
  const maxFrameRate = getLogicalMaxFrameRate(maxSampleRate, fftSize, sdrSettings);
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
  spectrumStateOverride,
}: UseSdrSettingsProps): UseSdrSettingsReturn => {
  const dispatch = useAppDispatch();
  const reduxState = useAppSelector((reduxState) => reduxState.spectrum);
  const state = spectrumStateOverride
    ? { ...reduxState, ...spectrumStateOverride }
    : reduxState;

  const maxFrameRate = useMemo(() => {
    return getLogicalMaxFrameRate(maxSampleRate, state.fftSize, sdrSettings);
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
      dispatch(setSdrSettingsBundle({ fftSize: size }));
      sendCurrentSettings({ fftSize: size });
    },
    [dispatch, sendCurrentSettings],
  );
  const setFftWindow = useCallback(
    (window: string) => {
      dispatch(setSdrSettingsBundle({ fftWindow: window }));
      sendCurrentSettings({ fftWindow: window });
    },
    [dispatch, sendCurrentSettings],
  );
  const setFftFrameRate = useCallback(
    (rate: number) => {
      dispatch(setFftFrameRateAction(rate));
      sendCurrentSettings({ frameRate: rate });
    },
    [dispatch, sendCurrentSettings],
  );
  const setGain = useCallback(
    (gain: number) => {
      dispatch(setSdrSettingsBundle({ gain }));
      sendCurrentSettings({ gain });
    },
    [dispatch, sendCurrentSettings],
  );
  const setTunerAGC = useCallback(
    (enabled: boolean) => {
      dispatch(setSdrSettingsBundle({ tunerAGC: enabled }));
      sendCurrentSettings({ tunerAGC: enabled });
    },
    [dispatch, sendCurrentSettings],
  );
  const setRtlAGC = useCallback(
    (enabled: boolean) => {
      dispatch(setSdrSettingsBundle({ rtlAGC: enabled }));
      sendCurrentSettings({ rtlAGC: enabled });
    },
    [dispatch, sendCurrentSettings],
  );
  const setPpm = useCallback(
    (ppm: number) => {
      dispatch(setSdrSettingsBundle({ ppm }));
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
          const desiredFrameRate = getLogicalMaxFrameRate(
            maxSampleRate,
            nextFftSize,
            sdrSettings,
          );
          if (desiredFrameRate !== nextFrameRate) {
            setFftFrameRate(desiredFrameRate);
            sendCurrentSettings({ frameRate: desiredFrameRate });
          }
          return;
        }

        const logicalDesiredFftSize = getBestLogicalFftSizeForFrameRate(
          nextFrameRate,
          fftSizeOptions,
          sdrSettings,
        );
        let desiredFftSize = logicalDesiredFftSize ?? fftSizeOptions[0];
        if (desiredFftSize === undefined) return;

        if (!logicalDesiredFftSize) {
          const maxFftSizeForRate = Math.floor(
            maxSampleRate / Math.max(1, nextFrameRate),
          );
          for (const size of fftSizeOptions) {
            if (size <= maxFftSizeForRate) desiredFftSize = size;
            else break;
          }
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

  // Initialize settings from sdrSettings if not already set
  useEffect(() => {
    if (sdrSettings?.fft?.default_size && state.fftSize !== sdrSettings.fft.default_size) {
      setFftSize(sdrSettings.fft.default_size);
    }
    if (sdrSettings?.gain?.tuner_gain && state.gain !== sdrSettings.gain.tuner_gain) {
      setGain(sdrSettings.gain.tuner_gain);
    }
    if (sdrSettings?.ppm !== undefined && state.ppm !== sdrSettings.ppm) {
      setPpm(sdrSettings.ppm);
    }
    if (sdrSettings?.gain?.rtl_agc !== undefined && state.rtlAGC !== sdrSettings.gain.rtl_agc) {
      setRtlAGC(sdrSettings.gain.rtl_agc);
    }
    if (sdrSettings?.gain?.tuner_agc !== undefined && state.tunerAGC !== sdrSettings.gain.tuner_agc) {
      setTunerAGC(sdrSettings.gain.tuner_agc);
    }
  }, [sdrSettings, state.fftSize, state.gain, state.ppm, state.rtlAGC, state.tunerAGC, setFftSize, setGain, setPpm, setRtlAGC, setTunerAGC]);

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

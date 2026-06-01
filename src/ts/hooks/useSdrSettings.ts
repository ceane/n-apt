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
  minReceiveSampleRate?: number;
  sampleRateOptions?: number[];
  sdrSettings?: any;
  deviceType?: string;
  onSettingsChange?: (settings: SDRSettings) => void;
  spectrumStateOverride?: Pick<
    SpectrumState,
    | "fftSize"
    | "fftWindow"
    | "fftFrameRate"
    | "gain"
    | "hackrfLnaGain"
    | "hackrfVgaGain"
    | "hackrfAmpEnabled"
    | "hackrfBasebandBandwidth"
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
  hackrfLnaGain: number;
  hackrfVgaGain: number;
  hackrfAmpEnabled: boolean;
  hackrfBasebandBandwidth: number | null;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  fftSizeOptions: number[];
  sampleRateOptions: number[];
  clampGain: (val: number) => number;
  setFftSize: (size: number) => void;
  setFftWindow: (window: string) => void;
  setFftFrameRate: (rate: number) => void;
  setSampleRate: (rate: number) => void;
  setGain: (gain: number) => void;
  setHackrfLnaGain: (gain: number) => void;
  setHackrfVgaGain: (gain: number) => void;
  setHackrfAmpEnabled: (enabled: boolean) => void;
  setHackrfBasebandBandwidth: (bandwidth: number | null) => void;
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

export const MAX_SCREEN_REFRESH_RATE = 60;

export const computeMaxFrameRate = (
  maxSampleRate: number,
  fftSize: number,
  maxFrameRateLimit?: number,
): number => {
  if (!fftSize) return 0;
  // Fallback calculation: floor(sample_rate / fft_size) clamped to range [1, MAX_SCREEN_REFRESH_RATE]
  const theoretical = Math.floor(maxSampleRate / fftSize);
  const limit = Math.min(
    maxFrameRateLimit ?? MAX_SCREEN_REFRESH_RATE,
    MAX_SCREEN_REFRESH_RATE,
  );
  return Math.max(1, Math.min(theoretical, limit));
};

const getLogicalSizeToFrameRate = (sdrSettings?: any): Map<number, number> => {
  const sizeMap = sdrSettings?.fft?.size_to_frame_rate;
  if (!sizeMap) return new Map();

  return new Map(
    Object.entries(sizeMap)
      .reduce<[number, number][]>((acc, [size, frameRate]) => {
        const s = Number(size);
        const r = Number(frameRate);
        if (Number.isFinite(s) && s > 0 && Number.isFinite(r) && r > 0)
          acc.push([s, r]);
        return acc;
      }, [])
      .sort((a, b) => a[0] - b[0]),
  );
};

export const getLogicalMaxFrameRate = (
  maxSampleRate: number,
  fftSize: number,
  sdrSettings?: any,
): number => {
  const logicalMap = getLogicalSizeToFrameRate(sdrSettings);
  const mapped = logicalMap.get(fftSize);
  if (typeof mapped === "number") {
    // Inherit directly from the backend's size_to_frame_rate map (already floor(sample_rate / fft_size) clamped to max logical frame rate)
    return mapped;
  }

  return computeMaxFrameRate(
    maxSampleRate,
    fftSize,
    sdrSettings?.fft?.max_frame_rate,
  );
};

const hasPersistedSpectrumSettings = (): boolean => {
  if (typeof window === "undefined") return false;

  const storageKeys = ["napt-sdr-settings-v2", "napt-sdr-settings"];

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of storageKeys) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;

        const parsed = JSON.parse(raw) as { fftSize?: unknown };
        if (
          typeof parsed.fftSize === "number" &&
          Number.isFinite(parsed.fftSize) &&
          parsed.fftSize > 0
        ) {
          return true;
        }
      } catch {
        // Ignore invalid cache entries and continue checking other stores.
      }
    }
  }

  return false;
};

export const deriveStateFromConfig = (
  maxSampleRate: number,
  sdrSettings?: any,
): Partial<SpectrumState> => {
  const fft = sdrSettings?.fft;
  const gainConfig = sdrSettings?.gain;
  const fftSize = typeof fft?.default_size === "number" ? fft.default_size : 0;
  const maxFrameRate = getLogicalMaxFrameRate(
    maxSampleRate,
    fftSize,
    sdrSettings,
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
    hackrfLnaGain:
      typeof gainConfig?.hackrf_lna_gain === "number"
        ? gainConfig.hackrf_lna_gain
        : 49.6,
    hackrfVgaGain:
      typeof gainConfig?.hackrf_vga_gain === "number"
        ? gainConfig.hackrf_vga_gain
        : 62,
    hackrfAmpEnabled: gainConfig?.hackrf_amp_enable ?? false,
    hackrfBasebandBandwidth:
      typeof gainConfig?.tuner_bandwidth === "number"
        ? gainConfig.tuner_bandwidth
        : 0,
    tunerAGC: gainConfig?.tuner_agc ?? false,
    rtlAGC: gainConfig?.rtl_agc ?? false,
    ppm: typeof sdrSettings?.ppm === "number" ? sdrSettings.ppm : 0,
  };
};

const buildSampleRateOptions = (
  maxSampleRate: number,
  minReceiveSampleRate?: number,
): number[] => {
  const floor = Math.max(1, Math.floor(minReceiveSampleRate ?? 3_200_000));
  const ceiling = Math.max(floor, Math.floor(maxSampleRate || floor));
  const candidates = [
    floor,
    2_400_000,
    3_200_000,
    4_000_000,
    5_000_000,
    6_000_000,
    8_000_000,
    10_000_000,
    12_000_000,
    16_000_000,
    20_000_000,
    ceiling,
  ];
  return Array.from(
    new Set(candidates.filter((rate) => rate >= floor && rate <= ceiling)),
  ).sort((a, b) => a - b);
};

export const useSdrSettings = ({
  maxSampleRate,
  minReceiveSampleRate,
  sampleRateOptions: backendSampleRateOptions,
  sdrSettings,
  deviceType,
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
  const sampleRateOptions = useMemo(() => {
    const backendRates = backendSampleRateOptions
      ?.filter((rate) => Number.isFinite(rate) && rate > 0)
      .sort((a, b) => a - b);

    if (backendRates && backendRates.length > 0) {
      return Array.from(new Set(backendRates));
    }

    return buildSampleRateOptions(
      maxSampleRate,
      minReceiveSampleRate ?? sdrSettings?.min_receive_sample_rate,
    );
  }, [
    maxSampleRate,
    minReceiveSampleRate,
    sdrSettings?.min_receive_sample_rate,
    backendSampleRateOptions,
  ]);

  const stateRef = useRef(state);
  const onSettingsChangeRef = useRef(onSettingsChange);
  const appliedConfigSignatureRef = useRef<string | null>(null);
  const hasPersistedSettingsRef = useRef(hasPersistedSpectrumSettings());

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
        ...(deviceType === "hackrf_one"
          ? {
              hackrfLnaGain: stateRef.current.hackrfLnaGain,
              hackrfVgaGain: stateRef.current.hackrfVgaGain,
              hackrfAmpEnabled: stateRef.current.hackrfAmpEnabled,
              tunerBandwidth:
                stateRef.current.hackrfBasebandBandwidth ?? undefined,
            }
          : {}),
        ...overrides,
      });
    },
    [deviceType],
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
  const setSampleRate = useCallback(
    (sampleRate: number) => {
      const isHackrfBasebandEnabled =
        (stateRef.current.hackrfBasebandBandwidth ?? 0) > 0;
      if (deviceType === "hackrf_one") {
        const nextHackrfBasebandBandwidth = isHackrfBasebandEnabled
          ? sampleRate
          : 0;
        dispatch(
          setSdrSettingsBundle({
            sampleRateHz: sampleRate,
            ...(isHackrfBasebandEnabled
              ? { hackrfBasebandBandwidth: nextHackrfBasebandBandwidth }
              : {}),
          }),
        );
        sendCurrentSettings({
          sampleRate,
          ...(isHackrfBasebandEnabled
            ? { tunerBandwidth: nextHackrfBasebandBandwidth }
            : { tunerBandwidth: 0 }),
        });
      } else {
        dispatch(setSdrSettingsBundle({ sampleRateHz: sampleRate }));
        sendCurrentSettings({ sampleRate });
      }
    },
    [dispatch, sendCurrentSettings, deviceType],
  );
  const setGain = useCallback(
    (gain: number) => {
      dispatch(setSdrSettingsBundle({ gain }));
      sendCurrentSettings({ gain });
    },
    [dispatch, sendCurrentSettings],
  );
  const setHackrfLnaGain = useCallback(
    (hackrfLnaGain: number) => {
      dispatch(setSdrSettingsBundle({ hackrfLnaGain }));
      sendCurrentSettings({ hackrfLnaGain });
    },
    [dispatch, sendCurrentSettings],
  );
  const setHackrfVgaGain = useCallback(
    (hackrfVgaGain: number) => {
      dispatch(setSdrSettingsBundle({ hackrfVgaGain }));
      sendCurrentSettings({ hackrfVgaGain });
    },
    [dispatch, sendCurrentSettings],
  );
  const setHackrfAmpEnabled = useCallback(
    (hackrfAmpEnabled: boolean) => {
      dispatch(setSdrSettingsBundle({ hackrfAmpEnabled }));
      sendCurrentSettings({ hackrfAmpEnabled });
    },
    [dispatch, sendCurrentSettings],
  );
  const setHackrfBasebandBandwidth = useCallback(
    (hackrfBasebandBandwidth: number | null) => {
      dispatch(setSdrSettingsBundle({ hackrfBasebandBandwidth }));
      sendCurrentSettings({
        tunerBandwidth: hackrfBasebandBandwidth ?? undefined,
      });
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
        .reduce<number[]>((acc, key) => {
          const size = Number(key);
          if (Number.isFinite(size)) acc.push(size);
          return acc;
        }, [])
        .sort((a, b) => a - b);
    }
    const fallback =
      typeof sdrSettings?.fft?.default_size === "number"
        ? [sdrSettings.fft.default_size]
        : [];
    return fallback;
  }, [sdrSettings]);

  useEffect(() => {
    if (fftSizeOptions.length > 0 && !fftSizeOptions.includes(state.fftSize)) {
      let bestSize = fftSizeOptions[0];
      for (const size of fftSizeOptions) {
        if (size <= state.fftSize) {
          bestSize = size;
        } else {
          break;
        }
      }
      setFftSize(bestSize);
    }
  }, [fftSizeOptions, state.fftSize, setFftSize]);

  const couplingTimerRef = useRef<number | null>(null);

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

        const cappedFrameRate = getLogicalMaxFrameRate(
          maxSampleRate,
          nextFftSize,
          sdrSettings,
        );
        const desiredFrameRate = Math.max(
          1,
          Math.min(nextFrameRate, cappedFrameRate),
        );
        if (desiredFrameRate !== nextFrameRate) {
          setFftFrameRate(desiredFrameRate);
          sendCurrentSettings({ frameRate: desiredFrameRate });
        }
      }, 300);
    },
    [
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

  // Initialize settings from sdrSettings when backend defaults change.
  // Do not reapply on local state updates, or user changes will be overwritten.
  useEffect(() => {
    const configSignature = JSON.stringify({
      fftDefaultSize: sdrSettings?.fft?.default_size ?? null,
      tunerGain: sdrSettings?.gain?.tuner_gain ?? null,
      hackrfLnaGain: sdrSettings?.gain?.hackrf_lna_gain ?? null,
      hackrfVgaGain: sdrSettings?.gain?.hackrf_vga_gain ?? null,
      hackrfAmpEnabled: sdrSettings?.gain?.hackrf_amp_enable ?? null,
      hackrfBasebandBandwidth: sdrSettings?.gain?.tuner_bandwidth ?? null,
      ppm: sdrSettings?.ppm ?? null,
      rtlAgc: sdrSettings?.gain?.rtl_agc ?? null,
      tunerAgc: sdrSettings?.gain?.tuner_agc ?? null,
    });

    if (appliedConfigSignatureRef.current === configSignature) {
      return;
    }

    appliedConfigSignatureRef.current = configSignature;

    // If the user already has persisted spectrum settings for this session,
    // do not reapply backend defaults and clobber their chosen FFT size.
    if (hasPersistedSettingsRef.current) {
      return;
    }

    if (sdrSettings?.fft?.default_size) {
      setFftSize(sdrSettings.fft.default_size);
    }
    if (sdrSettings?.gain?.tuner_gain) {
      setGain(sdrSettings.gain.tuner_gain);
    }
    if (sdrSettings?.gain?.hackrf_lna_gain !== undefined) {
      setHackrfLnaGain(sdrSettings.gain.hackrf_lna_gain);
    }
    if (sdrSettings?.gain?.hackrf_vga_gain !== undefined) {
      setHackrfVgaGain(sdrSettings.gain.hackrf_vga_gain);
    }
    if (sdrSettings?.gain?.hackrf_amp_enable !== undefined) {
      setHackrfAmpEnabled(sdrSettings.gain.hackrf_amp_enable);
    }
    if (sdrSettings?.gain?.tuner_bandwidth !== undefined) {
      setHackrfBasebandBandwidth(sdrSettings.gain.tuner_bandwidth);
    }
    if (sdrSettings?.ppm !== undefined) {
      setPpm(sdrSettings.ppm);
    }
    if (sdrSettings?.gain?.rtl_agc !== undefined) {
      setRtlAGC(sdrSettings.gain.rtl_agc);
    }
    if (sdrSettings?.gain?.tuner_agc !== undefined) {
      setTunerAGC(sdrSettings.gain.tuner_agc);
    }
  }, [
    sdrSettings,
    setFftSize,
    setGain,
    setHackrfAmpEnabled,
    setHackrfLnaGain,
    setHackrfVgaGain,
    setHackrfBasebandBandwidth,
    setPpm,
    setRtlAGC,
    setTunerAGC,
  ]);

  useEffect(() => {
    if (!maxFrameRate) return;
    if (stateRef.current.fftFrameRate > maxFrameRate) {
      setFftFrameRate(maxFrameRate);
    }
  }, [maxFrameRate, setFftFrameRate]);

  return {
    ...state,
    maxFrameRate,
    fftSizeOptions,
    sampleRateOptions,
    clampGain,
    setFftSize,
    setFftWindow,
    setFftFrameRate,
    setSampleRate,
    setGain,
    setHackrfLnaGain,
    setHackrfVgaGain,
    setHackrfAmpEnabled,
    setHackrfBasebandBandwidth,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    sendCurrentSettings,
    scheduleCoupledAdjustment,
  };
};

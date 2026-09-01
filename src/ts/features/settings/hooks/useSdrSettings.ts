import { useCallback, useMemo, useRef, useEffect } from "react";
import type { SDRSettings } from "@n-apt/consts/schemas/websocket";
import type { SpectrumState } from "@n-apt/spectrum/public/useSpectrumStore";
import {
  useAppDispatch,
  useAppSelector,
  setSdrSettingsBundle,
  setFftFrameRate as setFftFrameRateAction,
} from "@n-apt/redux";
import {
  clampFrameRateToLogicalMax,
  getLogicalMaxFrameRate,
} from "@n-apt/math/signals";

interface UseSdrSettingsProps {
  maxSampleRate: number;
  currentSampleRateHz?: number;
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

const hasPersistedSpectrumSettings = (deviceType?: string): boolean => {
  if (typeof window === "undefined") return false;

  const storageKeys = ["napt-sdr-settings-v2", "napt-sdr-settings"];

  if (deviceType) {
    const normalized = deviceType.toLowerCase().replace(/_/g, "-");
    const normalizedUnderscore = deviceType.toLowerCase().replace(/-/g, "_");
    storageKeys.push(`napt-spectrum-view-v1:${deviceType}`);
    storageKeys.push(`napt-spectrum-view-v1:${normalized}`);
    storageKeys.push(`napt-spectrum-view-v1:${normalizedUnderscore}`);
  }

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

    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith("napt-spectrum-view-v1:")) {
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
        }
      }
    } catch {
      // Ignore storage access errors.
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
  const derived: Partial<SpectrumState> = {};
  if (typeof fft?.default_size === "number") {
    derived.fftSize = fft.default_size;
    derived.fftFrameRate = getLogicalMaxFrameRate(
      maxSampleRate,
      fft.default_size,
      sdrSettings,
    );
  }
  if (typeof fft?.default_frame_rate === "number" && !derived.fftFrameRate) {
    derived.fftFrameRate = fft.default_frame_rate;
  }
  derived.gain =
    typeof gainConfig?.tuner_gain === "number" ? gainConfig.tuner_gain : 46.9;
  if (typeof gainConfig?.hackrf_lna_gain === "number") {
    derived.hackrfLnaGain = gainConfig.hackrf_lna_gain;
  }
  if (typeof gainConfig?.hackrf_vga_gain === "number") {
    derived.hackrfVgaGain = gainConfig.hackrf_vga_gain;
  }
  if (typeof gainConfig?.hackrf_amp_enable === "boolean") {
    derived.hackrfAmpEnabled = gainConfig.hackrf_amp_enable;
  }
  if (typeof gainConfig?.tuner_bandwidth === "number") {
    derived.hackrfBasebandBandwidth = gainConfig.tuner_bandwidth;
  }
  if (typeof gainConfig?.tuner_agc === "boolean") {
    derived.tunerAGC = gainConfig.tuner_agc;
  }
  if (typeof gainConfig?.rtl_agc === "boolean") {
    derived.rtlAGC = gainConfig.rtl_agc;
  }
  derived.ppm =
    typeof sdrSettings?.ppm === "number" ? sdrSettings.ppm : 1;
  return derived;
};

export const useSdrSettings = ({
  maxSampleRate,
  currentSampleRateHz,
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
    const currentSampleRate =
      currentSampleRateHz ?? state.sampleRateHz ?? maxSampleRate;
    return getLogicalMaxFrameRate(
      currentSampleRate,
      state.fftSize,
      sdrSettings,
    );
  }, [
    currentSampleRateHz,
    state.sampleRateHz,
    maxSampleRate,
    state.fftSize,
    sdrSettings,
  ]);
  const sampleRateOptions = useMemo(() => {
    const backendRates = backendSampleRateOptions
      ?.filter((rate) => Number.isFinite(rate) && rate > 0)
      .sort((a, b) => a - b);

    if (backendRates && backendRates.length > 0) {
      return Array.from(new Set(backendRates));
    }

    return [];
  }, [
    maxSampleRate,
    minReceiveSampleRate,
    sdrSettings?.min_receive_sample_rate,
    backendSampleRateOptions,
  ]);

  const stateRef = useRef(state);
  const onSettingsChangeRef = useRef(onSettingsChange);
  const appliedConfigSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);

  /**
   * Publish a settings change to the backend. Only the fields being changed
   * (the `overrides`) are sent: a client whose Redux has not yet hydrated a
   * remote device change must never replay its stale local snapshot, or it
   * would clobber the device state for every other subscriber.
   */
  const sendCurrentSettings = useCallback(
    (overrides: Partial<SDRSettings> = {}) => {
      onSettingsChangeRef.current?.(overrides);
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
  const setSampleRate = useCallback(
    (sampleRate: number) => {
      const currentFftSize = stateRef.current.fftSize;
      const nextFrameRate = getLogicalMaxFrameRate(
        sampleRate,
        currentFftSize,
        sdrSettings,
      );
      if (deviceType === "hackrf_one") {
        // Auto-tracking follows the sample rate unless the user pinned a
        // custom baseband-filter value. While pinned, keep the bandwidth
        // fixed and only change the rate.
        const basebandIsPinned = stateRef.current.basebandFilterPinned;
        const nextHackrfBasebandBandwidth = basebandIsPinned
          ? stateRef.current.hackrfBasebandBandwidth
          : stateRef.current.hackrfBasebandBandwidth === 0
            ? 0
            : sampleRate;
        dispatch(
          setSdrSettingsBundle({
            sampleRateHz: sampleRate,
            ...(nextHackrfBasebandBandwidth !== null
              ? { hackrfBasebandBandwidth: nextHackrfBasebandBandwidth }
              : {}),
            fftFrameRate: nextFrameRate,
          }),
        );
        sendCurrentSettings({
          sampleRate,
          frameRate: nextFrameRate,
          ...(nextHackrfBasebandBandwidth !== null &&
          nextHackrfBasebandBandwidth !== undefined
            ? { tunerBandwidth: nextHackrfBasebandBandwidth }
            : {}),
        });
      } else {
        dispatch(
          setSdrSettingsBundle({
            sampleRateHz: sampleRate,
            fftFrameRate: nextFrameRate,
          }),
        );
        sendCurrentSettings({ sampleRate, frameRate: nextFrameRate });
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
        const currentSampleRate =
          currentSampleRateHz ?? stateRef.current.sampleRateHz ?? maxSampleRate;

        if (trigger === "fftSize") {
          const cappedFrameRate = getLogicalMaxFrameRate(
            currentSampleRate,
            nextFftSize,
            sdrSettings,
          );
          const desiredFrameRate = clampFrameRateToLogicalMax(
            nextFrameRate,
            cappedFrameRate,
          );
          if (desiredFrameRate !== nextFrameRate) {
            setFftFrameRate(desiredFrameRate);
            sendCurrentSettings({ frameRate: desiredFrameRate });
          }
          return;
        }

        const cappedFrameRate = getLogicalMaxFrameRate(
          currentSampleRate,
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
      currentSampleRateHz,
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
    if (hasPersistedSpectrumSettings(deviceType)) {
      return;
    }

    if (sdrSettings?.fft?.default_size) {
      const defaultFftSize = sdrSettings.fft.default_size;
      const currentSampleRate =
        currentSampleRateHz ?? stateRef.current.sampleRateHz ?? maxSampleRate;
      const defaultFrameRate = getLogicalMaxFrameRate(
        currentSampleRate,
        defaultFftSize,
        sdrSettings,
      );
      dispatch(
        setSdrSettingsBundle({
          fftSize: defaultFftSize,
          fftFrameRate: defaultFrameRate,
        }),
      );
      sendCurrentSettings({
        fftSize: defaultFftSize,
        frameRate: defaultFrameRate,
      });
    }
    if (sdrSettings?.gain?.tuner_gain !== undefined) {
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
    if (
      (typeof state.hackrfBasebandBandwidth !== "number" ||
        state.hackrfBasebandBandwidth === null) &&
      sdrSettings?.gain?.tuner_bandwidth !== undefined
    ) {
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
    currentSampleRateHz,
    state.hackrfBasebandBandwidth,
    dispatch,
    maxSampleRate,
    sendCurrentSettings,
  ]);

  useEffect(() => {
    const defaultFftSize = sdrSettings?.fft?.default_size;
    const currentSampleRate =
      currentSampleRateHz ?? state.sampleRateHz ?? maxSampleRate;
    if (
      deviceType !== "hackrf_one" ||
      !defaultFftSize ||
      !Number.isFinite(currentSampleRate) ||
      currentSampleRate <= 0 ||
      state.fftSize <= currentSampleRate
    ) {
      return;
    }

    const defaultFrameRate = getLogicalMaxFrameRate(
      currentSampleRate,
      defaultFftSize,
      sdrSettings,
    );
    dispatch(
      setSdrSettingsBundle({
        fftSize: defaultFftSize,
        fftFrameRate: defaultFrameRate,
      }),
    );
    sendCurrentSettings({
      fftSize: defaultFftSize,
      frameRate: defaultFrameRate,
    });
  }, [
    currentSampleRateHz,
    deviceType,
    dispatch,
    maxSampleRate,
    sdrSettings,
    sendCurrentSettings,
    state.fftSize,
    state.sampleRateHz,
  ]);

  useEffect(() => {
    if (!maxFrameRate) return;
    if (stateRef.current.fftFrameRate > maxFrameRate) {
      setFftFrameRate(maxFrameRate);
    }
  }, [maxFrameRate, setFftFrameRate]);

  useEffect(() => {
    if (
      maxFrameRate <= 1 ||
      state.fftFrameRate > 1
    ) {
      return;
    }

    setFftFrameRate(maxFrameRate);
  }, [maxFrameRate, setFftFrameRate, state.fftFrameRate]);

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

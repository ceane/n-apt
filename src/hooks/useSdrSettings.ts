import { useReducer, useCallback, useMemo, useRef, useEffect } from "react";
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
  scheduleCoupledAdjustment: (
    trigger: "fftSize" | "frameRate",
    fftSize: number,
    frameRate: number,
  ) => void;
}

type SdrState = {
  fftSize: number;
  fftWindow: string;
  fftFrameRate: number;
  gain: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  ppm: number;
};

type SdrAction =
  | { type: "SET_FFT_SIZE"; size: number }
  | { type: "SET_FFT_WINDOW"; window: string }
  | { type: "SET_FFT_FRAME_RATE"; rate: number }
  | { type: "SET_GAIN"; gain: number }
  | { type: "SET_TUNER_AGC"; enabled: boolean }
  | { type: "SET_RTL_AGC"; enabled: boolean }
  | { type: "SET_PPM"; ppm: number };

function sdrReducer(state: SdrState, action: SdrAction): SdrState {
  switch (action.type) {
    case "SET_FFT_SIZE":
      return { ...state, fftSize: action.size };
    case "SET_FFT_WINDOW":
      return { ...state, fftWindow: action.window };
    case "SET_FFT_FRAME_RATE":
      return { ...state, fftFrameRate: action.rate };
    case "SET_GAIN":
      return { ...state, gain: action.gain };
    case "SET_TUNER_AGC":
      return { ...state, tunerAGC: action.enabled };
    case "SET_RTL_AGC":
      return { ...state, rtlAGC: action.enabled };
    case "SET_PPM":
      return { ...state, ppm: action.ppm };
  }
}

function createInitialState(maxSampleRate: number): SdrState {
  const theoretical = maxSampleRate / 32768;
  return {
    fftSize: 32768,
    fftWindow: "Rectangular",
    fftFrameRate: Math.max(1, Math.floor(Math.min(theoretical, 60))),
    gain: 49.6,
    tunerAGC: false,
    rtlAGC: false,
    ppm: 1,
  };
}

export const useSdrSettings = ({
  maxSampleRate,
  onSettingsChange,
}: UseSdrSettingsProps): UseSdrSettingsReturn => {
  const [state, dispatch] = useReducer(sdrReducer, maxSampleRate, createInitialState);

  const maxFrameRate = useMemo(() => {
    const theoretical = maxSampleRate / state.fftSize;
    return Math.max(1, Math.floor(Math.min(theoretical, 60)));
  }, [state.fftSize, maxSampleRate]);

  const stateRef = useRef(state);
  const onSettingsChangeRef = useRef(onSettingsChange);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);

  const sendCurrentSettings = useCallback((overrides: Partial<SDRSettings> = {}) => {
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
  }, []);

  const setFftSize = useCallback(
    (size: number) => {
      dispatch({ type: "SET_FFT_SIZE", size });
      sendCurrentSettings({ fftSize: size });
    },
    [sendCurrentSettings],
  );
  const setFftWindow = useCallback(
    (window: string) => {
      dispatch({ type: "SET_FFT_WINDOW", window });
      sendCurrentSettings({ fftWindow: window });
    },
    [sendCurrentSettings],
  );
  const setFftFrameRate = useCallback(
    (rate: number) => {
      dispatch({ type: "SET_FFT_FRAME_RATE", rate });
      sendCurrentSettings({ frameRate: rate });
    },
    [sendCurrentSettings],
  );
  const setGain = useCallback(
    (gain: number) => {
      dispatch({ type: "SET_GAIN", gain });
      sendCurrentSettings({ gain });
    },
    [sendCurrentSettings],
  );
  const setTunerAGC = useCallback(
    (enabled: boolean) => {
      dispatch({ type: "SET_TUNER_AGC", enabled });
      sendCurrentSettings({ tunerAGC: enabled });
    },
    [sendCurrentSettings],
  );
  const setRtlAGC = useCallback(
    (enabled: boolean) => {
      dispatch({ type: "SET_RTL_AGC", enabled });
      sendCurrentSettings({ rtlAGC: enabled });
    },
    [sendCurrentSettings],
  );
  const setPpm = useCallback(
    (ppm: number) => {
      dispatch({ type: "SET_PPM", ppm });
      sendCurrentSettings({ ppm });
    },
    [sendCurrentSettings],
  );

  const clampGain = useCallback((val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(49.6, val));
  }, []);

  const fftSizeOptions = useMemo(() => [8192, 16384, 32768, 65536, 131072, 262144], []);
  const couplingTimerRef = useRef<number | null>(null);
  const skipFrameRateSyncRef = useRef(false);

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
          skipFrameRateSyncRef.current = true;
          setFftSize(desiredFftSize);
          sendCurrentSettings({ fftSize: desiredFftSize });
        }
      }, 300);
    },
    [fftSizeOptions, maxSampleRate, sendCurrentSettings, setFftFrameRate, setFftSize],
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
    if (skipFrameRateSyncRef.current) {
      skipFrameRateSyncRef.current = false;
      return;
    }
    setFftFrameRate(maxFrameRate);
  }, [maxFrameRate, setFftFrameRate]);

  const initialSettingsSent = useRef(false);
  useEffect(() => {
    if (!initialSettingsSent.current && onSettingsChange) {
      initialSettingsSent.current = true;
      sendCurrentSettings();
    }
  }, [sendCurrentSettings, onSettingsChange]);

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

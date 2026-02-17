import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import InfoPopover from "@n-apt/components/InfoPopover";
import FrequencyRangeSlider from "@n-apt/components/FrequencyRangeSlider";
import DrawMockNAPTSidebar from "./DrawMockNAPTSidebar";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import { renderSpectrumSvg, renderFullRangeSpectrumSvg, drawSpectrumGrid } from "@n-apt/fft/FFTCanvasRenderer";
import { FFT_AREA_MIN } from "@n-apt/consts";
import type {
  SDRSettings,
  DeviceState,
  DeviceLoadingReason,
  CaptureRequest,
  CaptureStatus,
  CaptureFileType,
} from "@n-apt/hooks/useWebSocket";

type NaptMetadata = {
  sample_rate?: number;
  center_frequency?: number;
  frequency_range?: [number, number];
  fft?: { size?: number; window?: string };
  format?: string;
  timestamp_utc?: string;
  hardware?: string;
  gain?: number;
  ppm?: number;
};

const SidebarContainer = styled.aside`
  width: 100%;
  height: 100vh;
  background-color: #0d0d0d;
  border-right: 1px solid #1a1a1a;
  display: flex;
  flex-direction: column;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px
    calc(24px + env(safe-area-inset-bottom, 0px));
  overflow-x: visible;
  position: relative;
  box-sizing: border-box;
`;

const ConnectionStatusContainer = styled.div`
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 24px;
`;

const ConnectionStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 70%;
  padding: 12px 16px;
  background-color: #141414;
  border-radius: 8px;
  border: 1px solid #1f1f1f;
`;

const StatusDot = styled.div<{ $connected: boolean; $loading?: boolean; $color?: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$color
      ? props.$color
      : props.$loading
        ? "#ffaa00"
        : props.$connected
          ? "#00d4ff"
          : "#ff4444"};
  box-shadow: ${(props) => {
    const c = props.$color
      ? props.$color
      : props.$loading
        ? "#ffaa00"
        : props.$connected
          ? "#00d4ff"
          : "#ff4444";
    return `0 0 8px ${c}`;
  }};
  flex-shrink: 0;
  ${(props) =>
    props.$loading &&
    `
    animation: pulse 1.5s ease-in-out infinite alternate;
  `}
  
  @keyframes pulse {
    from { opacity: 1; }
    to { opacity: 0.4; }
  }
`;

const StatusText = styled.span`
  font-size: 12px;
  color: #888;
  font-weight: 500;
`;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? "#2a2a2a" : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$paused ? "#00d4ff" : "#2a2a2a")};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? "#00d4ff" : "#ccc")};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #2a2a2a;
    border-color: #00d4ff;
    color: #00d4ff;
  }
`;

const TabContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 12px 16px;
  background-color: ${(props) => (props.$active ? "#1a1a1a" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "#2a2a2a" : "transparent")};
  border-radius: 8px;
  color: ${(props) => (props.$active ? "#00d4ff" : "#666")};
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #1a1a1a;
    color: ${(props) => (props.$active ? "#00d4ff" : "#888")};
  }
`;

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? "#d9aa34" : "#555")};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const SectionTitleCollapsible = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0 0 16px 0;
  cursor: pointer;
  text-align: left;
`;

const SectionTitleLabel = styled.span<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? "#d9aa34" : "#555")};
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const SectionTitleToggle = styled.span`
  font-size: 12px;
  color: #555;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`;

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 80px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

const SettingInput = styled.input`
  background-color: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 6px;
  width: 70px;
  text-align: right;
  
  /* Hide number input spinners */
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  &[type="number"] {
    -moz-appearance: textfield;
  }
`;

const CollapsibleBody = styled.div`
  margin-top: 8px;
`;

const ToggleSwitch = styled.label<{ $disabled?: boolean }>`
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.4 : 1)};
`;

const ToggleSwitchInput = styled.input`
  opacity: 0;
  width: 44px;
  height: 24px;
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};

  &:checked + span {
    background-color: #00d4ff;
  }

  &:checked + span:before {
    transform: translateX(20px);
  }

  &:disabled + span {
    cursor: not-allowed;
  }
`;

const ToggleSwitchSlider = styled.span<{ $disabled?: boolean }>`
  position: absolute;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #444;
  transition: 0.2s;
  border-radius: 24px;

  &:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }
`;

interface SidebarProps {
  isAuthenticated: boolean;
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  _serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  maxSampleRateHz: number | null;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  captureStatus: CaptureStatus;
  onCaptureCommand: (req: CaptureRequest) => void;
  spectrumFrames?: Array<{ id: string; label: string; min_mhz: number; max_mhz: number; description: string }>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  drawParams: {
    spikeCount: number;
    spikeWidth: number;
    centerSpikeBoost: number;
    floorAmplitude: number;
    decayRate: number;
    envelopeWidth: number;
  };
  onDrawParamsChange: (params: any) => void;
  sourceMode: "live" | "file";
  onSourceModeChange: (mode: "live" | "file") => void;
  stitchStatus: string;
  activeSignalArea: string;
  onSignalAreaChange: (area: string) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
  frequencyRange?: { min: number; max: number };
  onPauseToggle: () => void;
  onSettingsChange?: (settings: SDRSettings) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
  onDisplayTemporalResolutionChange?: (resolution: "low" | "medium" | "high") => void;
  selectedFiles: { name: string; file: File }[];
  onSelectedFilesChange: (files: { name: string; file: File }[]) => void;
  stitchSourceSettings: { gain: number; ppm: number };
  onStitchSourceSettingsChange: (settings: { gain: number; ppm: number }) => void;
  isStitchPaused: boolean;
  onStitchPauseToggle: () => void;
  onStitch: () => void;
  onClear: () => void;
  onRestartDevice?: () => void;
  snapshotGridPreference?: boolean;
  onSnapshotGridPreferenceChange?: (preference: boolean) => void;
  fftWaveform?: Float32Array | number[] | null;
  getCurrentWaveform?: () => Float32Array | number[] | null;
  centerFrequencyMHz?: number;
  showInternalTabs?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  isConnected,
  isAuthenticated,
  deviceState,
  deviceLoadingReason,
  isPaused,
  _serverPaused: _unusedServerPaused,
  backend,
  deviceInfo,
  maxSampleRateHz,
  sessionToken,
  aesKey,
  captureStatus,
  onCaptureCommand,
  spectrumFrames,
  activeTab,
  onTabChange,
  drawParams,
  onDrawParamsChange,
  sourceMode,
  onSourceModeChange,
  stitchStatus,
  activeSignalArea,
  onSignalAreaChange,
  onFrequencyRangeChange,
  frequencyRange,
  onPauseToggle,
  onSettingsChange,
  displayTemporalResolution,
  onDisplayTemporalResolutionChange,
  selectedFiles,
  onSelectedFilesChange,
  onStitch,
  onClear,
  stitchSourceSettings,
  onStitchSourceSettingsChange,
  isStitchPaused,
  onStitchPauseToggle,
  onRestartDevice,
  snapshotGridPreference,
  onSnapshotGridPreferenceChange,
  fftWaveform,
  getCurrentWaveform,
  centerFrequencyMHz,
  showInternalTabs = true,
}) => {
  // Live retune toggle state (default on)
  const liveRetune = true;
  void liveRetune;

  // FFT settings defaults tuned for realistic 3.2 Msps RTL-SDR throughput
  const [fftSize, setFftSize] = useState(32768);
  const [fftWindow, setFftWindow] = useState("Rectangular");
  const [maxSampleRate, setMaxSampleRate] = useState(3_200_000); // Default 3.2MHz

  // Calculate logical max frame rate based on FFT size and sample rate
  const maxFrameRate = useMemo(() => {
    const theoretical = maxSampleRate / fftSize;
    return Math.max(1, Math.floor(Math.min(theoretical, 60))); // Cap at 60Hz screen refresh rate
  }, [fftSize, maxSampleRate]);

  // Set frame rate to logical max on mount/update
  const [fftFrameRate, setFftFrameRate] = useState(() => {
    const theoretical = 3_200_000 / 32768; // Default sample rate / FFT size
    return Math.max(1, Math.floor(Math.min(theoretical, 60)));
  });

  // Capture UI state
  const [captureOnscreen, setCaptureOnscreen] = useState(true);
  const [captureAreaA, setCaptureAreaA] = useState(false);
  const [captureAreaB, setCaptureAreaB] = useState(false);
  const [captureDurationS, setCaptureDurationS] = useState(1);
  const [captureFileType, setCaptureFileType] = useState<CaptureFileType>(".napt");
  const [captureEncrypted, setCaptureEncrypted] = useState(true);
  const [capturePlayback, setCapturePlayback] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  // Snapshot UI state (default closed)
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotWhole, setSnapshotWhole] = useState(false);
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = useState(false);
  const [snapshotShowStats, setSnapshotShowStats] = useState(true);
  const [snapshotFormat, setSnapshotFormat] = useState<"png" | "svg">("png");
  const [gain, setGain] = useState(49.6);
  const [tunerAGC, setTunerAGC] = useState(false);
  const [rtlAGC, setRtlAGC] = useState(false);

  const clampGain = useCallback((val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(49.6, val));
  }, []);
  const [ppm, setPpm] = useState(1);

  const temporalResolution = displayTemporalResolution ?? "medium";

  // Drive sample rate from backend status to avoid brittle deviceInfo parsing.
  useEffect(() => {
    if (typeof maxSampleRateHz === "number" && Number.isFinite(maxSampleRateHz) && maxSampleRateHz > 0) {
      setMaxSampleRate(maxSampleRateHz);
    }
  }, [maxSampleRateHz]);

  // Update frame rate to logical max when FFT size or sample rate changes
  useEffect(() => {
    setFftFrameRate(maxFrameRate);
  }, [maxFrameRate]);

  useEffect(() => {
    if (captureFileType === ".napt") {
      setCaptureEncrypted(true);
    }
  }, [captureFileType]);

  // Parse device frequency from deviceInfo for accurate range calculation
  const deviceFrequency = useMemo(() => {
    if (!deviceInfo) return null;

    const match = deviceInfo.match(/Freq:\s*(\d+)\s*Hz/);
    if (match) {
      const freqHz = parseInt(match[1]);
      return freqHz / 1_000_000; // Convert to MHz
    }
    return null;
  }, [deviceInfo]);

  const captureRange = useMemo(() => {
    if (!frequencyRange) {
      return { min: 0, max: 0, segments: [] as Array<{ label: string; min: number; max: number }> };
    }

    // If frequency range is still the default (0.0-3.2) but we have device frequency, 
    // adjust to actual device range
    let adjustedRange = frequencyRange;
    if (frequencyRange.min === 0.0 && frequencyRange.max === 3.2 && maxSampleRate > 0 && deviceFrequency) {
      const halfBandwidth = maxSampleRate / 2_000_000; // Convert to MHz
      adjustedRange = {
        min: Math.max(0, deviceFrequency - halfBandwidth),
        max: deviceFrequency + halfBandwidth,
      };
    }

    const fallbackA = { label: "A", min: 0.0, max: 4.47 };
    const fallbackB = { label: "B", min: 24.72, max: 29.88 };

    const findFrameByLabel = (label: string) =>
      spectrumFrames?.find((f) => f.label.toLowerCase() === label.toLowerCase()) ?? null;

    const frameA = findFrameByLabel("A");
    const frameB = findFrameByLabel("B");

    const AREA_A = frameA
      ? { label: "A", min: frameA.min_mhz, max: frameA.max_mhz }
      : fallbackA;
    const AREA_B = frameB
      ? { label: "B", min: frameB.min_mhz, max: frameB.max_mhz }
      : fallbackB;

    const segments: Array<{ label: string; min: number; max: number }> = [];
    if (captureOnscreen) segments.push({ label: "Onscreen", min: adjustedRange.min, max: adjustedRange.max });
    if (captureAreaA) segments.push(AREA_A);
    if (captureAreaB) segments.push(AREA_B);

    if (segments.length === 0) {
      segments.push({ label: "Onscreen", min: adjustedRange.min, max: adjustedRange.max });
    }

    return {
      min: Math.min(...segments.map((r) => r.min)),
      max: Math.max(...segments.map((r) => r.max)),
      segments,
    };
  }, [frequencyRange, captureOnscreen, captureAreaA, captureAreaB, maxSampleRate, spectrumFrames, deviceFrequency]);

  const handleCapture = useCallback(() => {
    // Allow captures in mock mode too (deviceState may be "disconnected" there)
    if (!isConnected || deviceState === "loading") return;
    if (!isAuthenticated) return;

    // Validate capture range
    if (captureRange.min === 0 && captureRange.max === 0) return;

    const jobId = `cap_${Date.now()}`;
    const req: CaptureRequest = {
      jobId,
      minFreq: captureRange.min,
      maxFreq: captureRange.max,
      durationS: Math.max(1, Math.round(Number(captureDurationS) || 1)),
      fileType: captureFileType,
      encrypted: captureFileType === ".napt" ? true : captureEncrypted,
      fftSize,
      fftWindow,
    };
    onCaptureCommand(req);
  }, [
    isConnected,
    deviceState,
    isAuthenticated,
    captureRange.min,
    captureRange.max,
    captureDurationS,
    captureFileType,
    captureEncrypted,
    fftSize,
    fftWindow,
    onCaptureCommand,
  ]);

  const handleWholeRangeSnapshot = useCallback(async () => {
    if (!onFrequencyRangeChange || !frequencyRange) {
      alert("Whole range snapshot requires frequency range control");
      return;
    }

    // Constants for full range capture
    const FULL_MIN_FREQ = 0;
    const FULL_MAX_FREQ = 4.47; // From DEFAULT_MAX_FREQ
    const WINDOW_SIZE = 3.2; // NAPT_FREQUENCY_RANGE
    const OVERLAP = 0.1; // Small overlap to ensure seamless stitching

    // Save current frequency range
    const originalRange = { ...frequencyRange };

    // Calculate window positions
    const windows: Array<{ min: number; max: number }> = [];
    let currentMin = FULL_MIN_FREQ;

    while (currentMin < FULL_MAX_FREQ) {
      const windowMax = Math.min(currentMin + WINDOW_SIZE, FULL_MAX_FREQ);
      windows.push({ min: currentMin, max: windowMax });
      if (windowMax >= FULL_MAX_FREQ) break;
      currentMin = windowMax - OVERLAP;
    }

    console.log(`Capturing ${windows.length} windows to cover ${FULL_MIN_FREQ}-${FULL_MAX_FREQ} MHz`);

    // Find canvas elements
    const spectrumWebGPU = document.getElementById("fft-spectrum-canvas-webgpu") as HTMLCanvasElement | null;
    const spectrum2D = document.getElementById("fft-spectrum-canvas-2d") as HTMLCanvasElement | null;
    const spectrumCanvas = spectrum2D || spectrumWebGPU;

    const waterfallWebGPU = document.getElementById("fft-waterfall-canvas-webgpu") as HTMLCanvasElement | null;
    const waterfall2D = document.getElementById("fft-waterfall-canvas-2d") as HTMLCanvasElement | null;
    const waterfallCanvas = waterfall2D || waterfallWebGPU;

    if (!spectrumCanvas) {
      alert("Canvas not found. Please ensure the FFT display is visible.");
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const spectrumW = spectrumCanvas.width / dpr;
    const spectrumH = spectrumCanvas.height / dpr;
    const plotW = spectrumW - FFT_AREA_MIN.x - 40;
    const plotH = spectrumH - FFT_AREA_MIN.y - 40;
    const spectrumPartHeight = FFT_AREA_MIN.y + plotH + 40;
    const waterfallH = snapshotShowWaterfall && waterfallCanvas ? waterfallCanvas.height / dpr : 0;
    const outW = FFT_AREA_MIN.x + windows.length * plotW + 40;
    const outH = spectrumPartHeight + waterfallH;

    const windowsWithWaveform: Array<{ min: number; max: number; waveform: number[] }> = [];
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outW * dpr;
    outputCanvas.height = outH * dpr;
    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) return;
    outputCtx.scale(dpr, dpr);
    outputCtx.imageSmoothingEnabled = false;

    const getCanvasScale = (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return { x: dpr, y: dpr };
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width ? canvas.width / rect.width : dpr;
      const scaleY = rect.height ? canvas.height / rect.height : dpr;
      return { x: scaleX, y: scaleY };
    };

    const spectrumScale = getCanvasScale(spectrumCanvas);
    const waterfallScale = getCanvasScale(waterfallCanvas);

    const sampleWaveformSignature = (wave: Float32Array | number[] | null | undefined): string | null => {
      if (!wave || wave.length === 0) return null;
      const len = wave.length;
      const midIdx = Math.floor(len / 2);
      const first = Number.isFinite(wave[0]) ? wave[0] : 0;
      const mid = Number.isFinite(wave[midIdx]) ? wave[midIdx] : 0;
      const last = Number.isFinite(wave[len - 1]) ? wave[len - 1] : 0;
      return `${len}:${first.toFixed(3)}:${mid.toFixed(3)}:${last.toFixed(3)}`;
    };

    const waitForNewFrame = async (previousSignature: string | null) => {
      const frameInterval = 1000 / Math.max(1, fftFrameRate);
      const serverLatencyBuffer = 400; // accounts for SDR retune + backend render delay
      const animationDelay = 1000; // UI transition/animation settling time
      const timeoutMs = Math.max(frameInterval * 2 + serverLatencyBuffer, animationDelay);

      // Let the browser present at least one frame before we start polling data
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      // Explicit wait so CSS/WebGPU transitions can settle
      await new Promise<void>((resolve) => setTimeout(resolve, animationDelay));

      const start = performance.now();
      await new Promise<void>((resolve) => {
        const poll = () => {
          const currentSignature = sampleWaveformSignature(getCurrentWaveform?.());
          if ((currentSignature && currentSignature !== previousSignature) || performance.now() - start >= timeoutMs) {
            resolve();
            return;
          }
          setTimeout(poll, Math.max(16, frameInterval / 2));
        };
        poll();
      });
    };

    for (let i = 0; i < windows.length; i++) {
      try {
        const win = windows[i];
        const prevSignature = sampleWaveformSignature(getCurrentWaveform?.());

        onFrequencyRangeChange(win);

        await waitForNewFrame(prevSignature);

        const currentCanvas = spectrum2D || spectrumWebGPU;
        if (currentCanvas && snapshotFormat !== "svg") {
          outputCtx.drawImage(
            currentCanvas,
            FFT_AREA_MIN.x * spectrumScale.x,
            FFT_AREA_MIN.y * spectrumScale.y,
            plotW * spectrumScale.x,
            plotH * spectrumScale.y,
            FFT_AREA_MIN.x + i * plotW,
            FFT_AREA_MIN.y,
            plotW,
            plotH,
          );
        }
        if (snapshotFormat === "svg" && getCurrentWaveform) {
          const w = getCurrentWaveform();
          const arr = w == null ? [] : Array.isArray(w) ? w : Array.from(w);
          windowsWithWaveform.push({ min: win.min, max: win.max, waveform: arr });
        }
        if (snapshotShowWaterfall && waterfallCanvas && snapshotFormat !== "svg") {
          const currentWaterfall = waterfall2D || waterfallWebGPU;
          if (currentWaterfall) {
            outputCtx.drawImage(
              currentWaterfall,
              0,
              0,
              currentWaterfall.width ?? (plotW * waterfallScale.x),
              currentWaterfall.height ?? (waterfallH * waterfallScale.y),
              FFT_AREA_MIN.x + i * plotW,
              spectrumPartHeight,
              plotW,
              waterfallH,
            );
          }
        }
        console.log(`Captured window ${i + 1}/${windows.length}: ${win.min.toFixed(2)}-${win.max.toFixed(2)} MHz`);
      } catch (error) {
        console.error(`Error capturing window ${i + 1}:`, error);
      }
    }

    onFrequencyRangeChange(originalRange);

    const min = FULL_MIN_FREQ;
    const max = FULL_MAX_FREQ;
    const baseName = `${min.toFixed(2)}-${max.toFixed(2)}MHz_WHOLE`;
    let blob: Blob | null = null;
    let fileName: string;

    if (snapshotFormat === "svg") {
      if (windowsWithWaveform.length === 0 || (windowsWithWaveform.length > 0 && windowsWithWaveform.every((w) => !w.waveform.length))) {
        console.warn("Whole-range SVG: no waveform data collected, falling back to PNG");
        outputCtx.fillStyle = "#0a0a0a";
        outputCtx.fillRect(0, 0, outW, outH);
        blob = await new Promise<Blob | null>((r) => outputCanvas.toBlob(r, "image/png", 1.0));
        fileName = `${baseName}.png`;
      } else {
        const spectrumSvg = renderFullRangeSpectrumSvg({
          width: outW,
          height: spectrumPartHeight,
          windows: windowsWithWaveform,
          fullRange: { min: FULL_MIN_FREQ, max: FULL_MAX_FREQ },
          showGrid: snapshotGridPreference ?? true,
          isDeviceConnected: deviceState === "connected",
        });
        blob = new Blob([spectrumSvg], { type: "image/svg+xml;charset=utf-8" });
        fileName = `${baseName}.svg`;
      }
    } else {
      drawSpectrumGrid({
        ctx: outputCtx,
        width: outW,
        height: spectrumPartHeight,
        frequencyRange: { min: FULL_MIN_FREQ, max: FULL_MAX_FREQ },
        clearBackground: false,
      });
      blob = await new Promise<Blob | null>((r) => outputCanvas.toBlob(r, "image/png", 1.0));
      fileName = `${baseName}.png`;
    }

    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      console.log(`Whole range snapshot saved: ${fileName}`);
    }
  }, [onFrequencyRangeChange, frequencyRange, snapshotFormat, snapshotShowWaterfall, snapshotGridPreference, deviceState, getCurrentWaveform]);

  const handleSnapshot = useCallback(async () => {
    // Check if we need to capture the whole range
    if (snapshotWhole) {
      await handleWholeRangeSnapshot();
      return;
    }

    // NOTE: Original single-window snapshot code
    // Find the visible spectrum canvas (WebGPU or 2D fallback)
    const spectrumWebGPU = document.getElementById("fft-spectrum-canvas-webgpu") as HTMLCanvasElement | null;
    const spectrum2D = document.getElementById("fft-spectrum-canvas-2d") as HTMLCanvasElement | null;
    // IMPORTANT: Always use 2D canvas for snapshots since WebGPU canvases cannot be read with drawImage()
    const spectrumCanvas = spectrum2D || spectrumWebGPU;

    if (!spectrumCanvas) {
      console.error("Snapshot failed: spectrum canvas not found");
      alert("Snapshot failed: Canvas not found. Please ensure the FFT display is visible.");
      return;
    }

    // Find the visible waterfall canvas (WebGPU or 2D fallback)
    const waterfallWebGPU = document.getElementById("fft-waterfall-canvas-webgpu") as HTMLCanvasElement | null;
    const waterfall2D = document.getElementById("fft-waterfall-canvas-2d") as HTMLCanvasElement | null;
    // IMPORTANT: Always use 2D canvas for snapshots since WebGPU canvases cannot be read with drawImage()
    const waterfallCanvas = waterfall2D || waterfallWebGPU;

    const outCanvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    const outW = spectrumCanvas.width / dpr;
    const outH = spectrumCanvas.height / dpr + (snapshotShowWaterfall && waterfallCanvas ? waterfallCanvas.height / dpr : 0);
    outCanvas.width = outW * dpr;
    outCanvas.height = outH * dpr;

    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Draw spectrum
    ctx.drawImage(spectrumCanvas, 0, 0, outW, spectrumCanvas.height / dpr);

    // Optional stats overlay
    if (snapshotShowStats && frequencyRange) {
      const text = `${frequencyRange.min.toFixed(2)}-${frequencyRange.max.toFixed(2)} MHz`;
      ctx.save();
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      const padding = 10;
      const x = outW - padding;
      const y = spectrumCanvas.height - padding;
      const metrics = ctx.measureText(text);
      const boxW = Math.ceil(metrics.width) + 14;
      const boxH = 22;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - boxW, y - boxH, boxW, boxH);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x - 7, y - 5);
      ctx.restore();
    }

    // Optional waterfall append
    if (snapshotShowWaterfall && waterfallCanvas) {
      ctx.drawImage(waterfallCanvas, 0, spectrumCanvas.height / dpr, outW, waterfallCanvas.height / dpr);
    }

    // Optional grid (best-effort): if disabled, we can't retroactively remove it.
    // This toggle will become authoritative when snapshot rendering is done from data.
    void snapshotGridPreference;

    const min = frequencyRange?.min ?? 0;
    const max = frequencyRange?.max ?? 0;
    const baseName = `${min.toFixed(2)}-${max.toFixed(2)}MHz`;

    let blob: Blob | null = null;
    let fileName: string;

    if (snapshotFormat === "svg") {
      const spectrumRect = spectrumCanvas.parentElement?.getBoundingClientRect();
      const spectrumW = Math.round(spectrumRect?.width ?? spectrumCanvas.width);
      const spectrumH = Math.round(spectrumRect?.height ?? spectrumCanvas.height);
      const waveformArray = fftWaveform ? Array.from(fftWaveform as any) : null;

      if (!waveformArray || waveformArray.length === 0 || !frequencyRange) {
        console.error("Snapshot failed: SVG export requires FFT waveform data");
        alert("Snapshot failed: SVG export needs FFT data. Try again once the spectrum is active.");
        return;
      }

      const spectrumSvg = renderSpectrumSvg({
        width: spectrumW,
        height: spectrumH,
        waveform: waveformArray,
        frequencyRange,
        centerFrequencyMHz: centerFrequencyMHz ?? (frequencyRange.min + frequencyRange.max) / 2,
        showGrid: snapshotGridPreference ?? true,
        isDeviceConnected: deviceState === "connected",
      });

      // If waterfall is enabled, append it as raster <image> under the vector spectrum.
      if (snapshotShowWaterfall && waterfallCanvas) {
        const waterfallDataUrl = waterfallCanvas.toDataURL("image/png");
        const waterfallRect = waterfallCanvas.parentElement?.getBoundingClientRect();
        const waterfallH = Math.round(waterfallRect?.height ?? waterfallCanvas.height);
        const totalH = spectrumH + waterfallH;

        const spectrumInner = spectrumSvg
          .replace(/^([\s\S]*?)<svg[^>]*>/, "")
          .replace(/<\/svg>\s*$/, "");

        const combined =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<svg xmlns="http://www.w3.org/2000/svg" width="${spectrumW}" height="${totalH}" viewBox="0 0 ${spectrumW} ${totalH}">` +
          `${spectrumInner}` +
          `<image x="0" y="${spectrumH}" width="${waterfallCanvas.width}" height="${waterfallCanvas.height}" href="${waterfallDataUrl}"/>` +
          `</svg>`;

        blob = new Blob([combined], { type: "image/svg+xml;charset=utf-8" });
      } else {
        blob = new Blob([spectrumSvg], { type: "image/svg+xml;charset=utf-8" });
      }

      fileName = `${baseName}.svg`;
    } else {
      blob = await new Promise((resolve) => outCanvas.toBlob(resolve, "image/png", 1.0));
      fileName = `${baseName}.png`;
    }

    if (!blob) {
      console.error("Snapshot failed: Could not create blob");
      alert("Snapshot failed: Could not create image file.");
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [
    snapshotWhole,
    handleWholeRangeSnapshot,
    snapshotShowWaterfall,
    snapshotShowStats,
    snapshotGridPreference,
    snapshotFormat,
    frequencyRange,
    fftWaveform,
    centerFrequencyMHz,
    deviceState,
  ]);

  // Send initial settings on mount when connected
  const initialSettingsSent = useRef(false);
  useEffect(() => {
    if (isConnected && deviceState === "connected" && !initialSettingsSent.current) {
      initialSettingsSent.current = true;
      onSettingsChange?.({
        fftSize,
        fftWindow,
        frameRate: fftFrameRate,
        gain,
        ppm,
        tunerAGC,
        rtlAGC,
      });
    }
    if (!isConnected) {
      initialSettingsSent.current = false;
    }
  }, [
    isConnected,
    deviceState,
    fftSize,
    fftWindow,
    fftFrameRate,
    gain,
    ppm,
    tunerAGC,
    rtlAGC,
    onSettingsChange,
  ]);

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

  // Computed values for file mode
  const fileCapturedRange = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length === 0) return null;
    // .napt files encode metadata internally, not in the filename.
    // For now, only derive captured range from .c64 filenames.
    let minFreq = Infinity;
    let maxFreq = -Infinity;
    for (const f of selectedFiles) {
      if (f.name.toLowerCase().endsWith(".napt")) {
        continue;
      }
      const match = f.name.match(/iq_(\d+\.?\d*)MHz/);
      if (match) {
        const freq = parseFloat(match[1]);
        minFreq = Math.min(minFreq, freq - 1.6);
        maxFreq = Math.max(maxFreq, freq + 1.6);
      }
    }
    if (minFreq === Infinity) return null;
    return { min: Math.max(0, minFreq), max: maxFreq };
  }, [sourceMode, selectedFiles]);

  const selectedNaptFile = useMemo(() => {
    if (sourceMode !== "file") return null;
    if (selectedFiles.length !== 1) return null;
    const f = selectedFiles[0];
    return f.name.toLowerCase().endsWith(".napt") ? f : null;
  }, [sourceMode, selectedFiles]);

  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNaptMetadata(null);
    setNaptMetadataError(null);

    const run = async () => {
      if (!selectedNaptFile) return;
      if (!aesKey) {
        setNaptMetadataError("Locked (no session key)");
        return;
      }

      try {
        const buf = await selectedNaptFile.file.arrayBuffer();
        const b64 = new TextDecoder().decode(new Uint8Array(buf)).trim();
        // Decrypt base64( IV||ciphertext ) → bytes( JSON + '\n' + raw IQ )
        const bytes = await decryptPayloadBytes(aesKey, b64);
        const newlineIdx = bytes.indexOf(10);
        if (newlineIdx <= 0) {
          throw new Error("Invalid NAPT payload (missing metadata header)");
        }
        const metaJson = new TextDecoder().decode(bytes.slice(0, newlineIdx));
        const meta = JSON.parse(metaJson) as NaptMetadata;
        if (!cancelled) {
          setNaptMetadata(meta);
          setNaptMetadataError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setNaptMetadata(null);
          setNaptMetadataError(e?.message || "Failed to read NAPT metadata");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedNaptFile, aesKey]);

  // Stitcher state (using props to sync with App component)
  const setSelectedFiles = onSelectedFilesChange;

  // Use refs to track last notified values to prevent excessive updates
  const lastNotifiedRangeRef = useRef({ min: 0, max: 3.2 });
  const stitchButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleAreaARangeChange = useCallback(
    (range: { min: number; max: number }) => {
      if (activeSignalArea === "A") {
        // Always notify for real-time spectral drift effect
        lastNotifiedRangeRef.current = range;
        onFrequencyRangeChange?.(range);
      }
    },
    [activeSignalArea, onFrequencyRangeChange],
  );

  const handleAreaBRangeChange = useCallback(
    (range: { min: number; max: number }) => {
      if (activeSignalArea === "B") {
        const minDiff = Math.abs(range.min - lastNotifiedRangeRef.current.min);
        const maxDiff = Math.abs(range.max - lastNotifiedRangeRef.current.max);
        if (minDiff > 0.01 || maxDiff > 0.01) {
          lastNotifiedRangeRef.current = range;
          onFrequencyRangeChange?.(range);
        }
      }
    },
    [activeSignalArea, onFrequencyRangeChange],
  );

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SidebarContainer>
      {/* Capturing indicator - always visible when capturing */}
      {captureStatus?.status === "started" && (
        <div style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          backgroundColor: "#ff4444",
          color: "white",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "JetBrains Mono, monospace",
          zIndex: 1000,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          <div style={{
            width: "8px",
            height: "8px",
            backgroundColor: "white",
            borderRadius: "50%",
            animation: "pulse 1.5s infinite"
          }} />
          Capturing... {captureStatus.jobId}
        </div>
      )}

      {showInternalTabs && (
        <TabContainer>
          <Tab $active={activeTab === "visualizer"} onClick={() => onTabChange("visualizer")}>
            See FFT of N-APT (LF/HF freqs)
          </Tab>
          <Tab $active={activeTab === "analysis"} onClick={() => onTabChange("analysis")}>
            Decode N-APT with ML
          </Tab>
          <Tab $active={activeTab === "draw"} onClick={() => onTabChange("draw")}>
            Draw N-APT with Math/ML
          </Tab>
        </TabContainer>
      )}

      {activeTab === "visualizer" && (
        <>
          {sourceMode === "live" && (
            <ConnectionStatusContainer>
              <ConnectionStatus>
                <StatusDot
                  $connected={isConnected && deviceState === "connected"}
                  $loading={deviceState === "loading" || deviceState === "stale"}
                  $color={isConnected && deviceState === "disconnected" ? "#ff8800" : undefined}
                />
                <StatusText>
                  {!isConnected
                    ? "Disconnected"
                    : deviceState === "loading"
                      ? deviceLoadingReason === "restart"
                        ? "Restarting device..."
                        : "Loading device..."
                      : deviceState === "stale"
                        ? "Device stream frozen"
                        : deviceState === "connected"
                          ? "Connected to server and device"
                          : "Connected to server but device not connected"}
                </StatusText>
              </ConnectionStatus>

              {isConnected &&
                (deviceState === "stale" ? (
                  <PauseButton
                    $paused={false}
                    onClick={() => onRestartDevice?.()}
                    title="Restart the SDR device connection"
                    style={{
                      flex: "0 0 25%",
                      borderColor: "#ffaa00",
                      color: "#ffaa00",
                    }}
                  >
                    Restart
                  </PauseButton>
                ) : deviceState === "loading" && deviceLoadingReason === "restart" ? (
                  <PauseButton
                    $paused={false}
                    onClick={() => { }}
                    disabled={true}
                    title="Device is restarting..."
                    style={{
                      flex: "0 0 25%",
                      opacity: 0.6,
                      cursor: "not-allowed",
                      borderColor: "#ffaa00",
                      color: "#ffaa00",
                    }}
                  >
                    Restarting...
                  </PauseButton>
                ) : deviceState === "loading" ? (
                  <PauseButton
                    $paused={false}
                    onClick={() => { }}
                    disabled={true}
                    title="Device is being initialized..."
                    style={{
                      flex: "0 0 25%",
                      opacity: 0.6,
                      cursor: "not-allowed",
                      borderColor: "#ffaa00",
                      color: "#ffaa00",
                    }}
                  >
                    Loading...
                  </PauseButton>
                ) : (
                  <PauseButton $paused={isPaused} onClick={onPauseToggle}>
                    {isPaused ? "Resume" : "Pause"}
                  </PauseButton>
                ))}
            </ConnectionStatusContainer>
          )}

          <Section>
            <SectionTitle $fileMode={sourceMode === "file"}>Source</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Input</SettingLabel>
                <InfoPopover
                  title="Source"
                  content="Select the signal source: live SDR device for real-time capture, or file selection to analyze previously recorded I/Q data."
                />
              </SettingLabelContainer>
              <SettingSelect
                value={sourceMode}
                onChange={(e) => onSourceModeChange(e.target.value as "live" | "file")}
                style={{ minWidth: "130px" }}
              >
                <option value="live">
                  {backend === "rtl-sdr" ? "RTL-SDR" : backend === "mock" ? "Mock SDR" : "Live SDR"}
                </option>
                <option value="file" style={{ color: "#d9aa34" }}>
                  File Selection
                </option>
              </SettingSelect>
            </SettingRow>
          </Section>

          {sourceMode === "live" && (
            <Section>
              <SectionTitleCollapsible type="button" onClick={() => setCaptureOpen((p) => !p)}>
                <SectionTitleLabel>I/Q Capture /</SectionTitleLabel>
                <SectionTitleToggle>{captureOpen ? "-" : "+"}</SectionTitleToggle>
              </SectionTitleCollapsible>

              {captureOpen && (
                <CollapsibleBody>

                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Areas</SettingLabel>
                    </SettingLabelContainer>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#ccc" }}>
                        <input
                          type="checkbox"
                          checked={captureOnscreen}
                          onChange={(e) => setCaptureOnscreen(e.target.checked)}
                        />
                        Onscreen
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#ccc" }}>
                        <input type="checkbox" checked={captureAreaA} onChange={(e) => setCaptureAreaA(e.target.checked)} />
                        A
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#ccc" }}>
                        <input type="checkbox" checked={captureAreaB} onChange={(e) => setCaptureAreaB(e.target.checked)} />
                        B
                      </label>
                    </div>
                  </SettingRow>

                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Range</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue style={{ whiteSpace: "normal", lineHeight: 1.25 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-end" }}>
                        {captureRange.segments.map((seg) => (
                          <div key={seg.label}>
                            {seg.label}: {seg.min === 0 ? "0kHz" : `${seg.min.toFixed(2)}MHz`} - {seg.max.toFixed(2)}MHz
                          </div>
                        ))}
                      </div>
                    </SettingValue>
                  </SettingRow>

                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Duration</SettingLabel>
                    </SettingLabelContainer>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <SettingInput
                        type="number"
                        min="1"
                        step="1"
                        value={Math.round(captureDurationS)}
                        onChange={(e) => setCaptureDurationS(parseInt(e.target.value) || 1)}
                        style={{ width: "60px", MozAppearance: "textfield", WebkitAppearance: "none" } as React.CSSProperties}
                      />
                      <span style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}>s</span>
                    </div>
                  </SettingRow>

                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>File type</SettingLabel>
                    </SettingLabelContainer>
                    <SettingSelect
                      value={captureFileType}
                      onChange={(e) => setCaptureFileType(e.target.value as CaptureFileType)}
                      style={{ minWidth: "110px" }}
                    >
                      <option value=".napt">.napt</option>
                      <option value=".c64">.c64</option>
                    </SettingSelect>
                  </SettingRow>

                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Encrypted</SettingLabel>
                    </SettingLabelContainer>
                    <ToggleSwitch $disabled={captureFileType === ".napt"}>
                      <ToggleSwitchInput
                        type="checkbox"
                        checked={captureFileType === ".napt" ? true : captureEncrypted}
                        disabled={captureFileType === ".napt"}
                        onChange={(e) => setCaptureEncrypted(e.target.checked)}
                      />
                      <ToggleSwitchSlider $disabled={captureFileType === ".napt"} />
                    </ToggleSwitch>
                  </SettingRow>

                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Sample size</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue>{maxSampleRate / 1000000}MHz</SettingValue>
                  </SettingRow>

                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                    <PauseButton
                      $paused={false}
                      onClick={handleCapture}
                      disabled={(!isConnected || deviceState === "loading" || !isAuthenticated) || captureStatus?.status === "started"}
                      style={{
                        flex: "1",
                        opacity: (!isConnected || deviceState === "loading" || !isAuthenticated) || captureStatus?.status === "started" ? 0.5 : 1,
                        cursor: (!isConnected || deviceState === "loading" || !isAuthenticated) || captureStatus?.status === "started" ? "not-allowed" : "pointer",
                      }}
                    >
                      {captureStatus?.status === "started" ? "Capturing..." : "Capture"}
                    </PauseButton>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="checkbox"
                        checked={capturePlayback}
                        onChange={(e) => setCapturePlayback(e.target.checked)}
                        style={{ margin: 0 }}
                      />
                      <label style={{ fontSize: "11px", color: "#ccc", whiteSpace: "nowrap", margin: 0 }}>
                        Playback after capture
                      </label>
                    </div>
                  </div>

                  {captureStatus?.status === "started" && (
                    <SettingRow style={{ marginTop: "12px" }}>
                      <SettingLabelContainer>
                        <SettingLabel>Status</SettingLabel>
                      </SettingLabelContainer>
                      <SettingValue style={{ color: "#ffaa00" }}>
                        Capturing... {captureStatus.jobId}
                      </SettingValue>
                    </SettingRow>
                  )}

                  {/* Downloads Section */}
                  {captureStatus?.status === "done" && captureStatus.downloadUrl && isAuthenticated && (
                    <div style={{ marginTop: "16px" }}>
                      <div style={{
                        fontSize: "11px",
                        color: "#555",
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                        marginBottom: "8px",
                        fontWeight: 600,
                        fontFamily: "JetBrains Mono, monospace"
                      }}>
                        Downloads
                      </div>
                      <div style={{
                        padding: "8px 12px",
                        backgroundColor: "#141414",
                        borderRadius: "6px",
                        border: "1px solid #2a2a2a"
                      }}>
                        <a
                          href={`${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`}
                          download={captureStatus.filename || "capture"}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "#00d4ff",
                            fontSize: "12px",
                            fontFamily: "JetBrains Mono, monospace",
                            textDecoration: "none",
                            display: "block",
                            wordBreak: "break-all",
                            maxWidth: "200px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                          title={captureStatus.filename || "Download"}
                        >
                          {captureStatus.filename || "Download"}
                        </a>
                      </div>
                    </div>
                  )}
                </CollapsibleBody>
              )}
            </Section>
          )}

          <Section>
            <SectionTitleCollapsible type="button" onClick={() => setSnapshotOpen((p) => !p)}>
              <SectionTitleLabel>Snapshot /</SectionTitleLabel>
              <SectionTitleToggle>{snapshotOpen ? "-" : "+"}</SectionTitleToggle>
            </SectionTitleCollapsible>

            {snapshotOpen && (
              <CollapsibleBody>
                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Range</SettingLabel>
                  </SettingLabelContainer>
                  <SettingSelect
                    value={snapshotWhole ? "whole" : "onscreen"}
                    onChange={(e) => setSnapshotWhole(e.target.value === "whole")}
                    style={{ minWidth: "120px" }}
                  >
                    <option value="onscreen">On screen</option>
                    <option value="whole">Whole</option>
                  </SettingSelect>
                </SettingRow>

                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Waterfall</SettingLabel>
                  </SettingLabelContainer>
                  <ToggleSwitch>
                    <ToggleSwitchInput
                      type="checkbox"
                      checked={snapshotShowWaterfall}
                      onChange={(e) => setSnapshotShowWaterfall(e.target.checked)}
                    />
                    <ToggleSwitchSlider />
                  </ToggleSwitch>
                </SettingRow>

                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Grid</SettingLabel>
                  </SettingLabelContainer>
                  <ToggleSwitch>
                    <ToggleSwitchInput
                      type="checkbox"
                      checked={snapshotGridPreference}
                      onChange={(e) => onSnapshotGridPreferenceChange?.(e.target.checked)}
                    />
                    <ToggleSwitchSlider />
                  </ToggleSwitch>
                </SettingRow>

                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Stats</SettingLabel>
                  </SettingLabelContainer>
                  <ToggleSwitch>
                    <ToggleSwitchInput
                      type="checkbox"
                      checked={snapshotShowStats}
                      onChange={(e) => setSnapshotShowStats(e.target.checked)}
                    />
                    <ToggleSwitchSlider />
                  </ToggleSwitch>
                </SettingRow>

                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Format</SettingLabel>
                  </SettingLabelContainer>
                  <SettingSelect
                    value={snapshotFormat}
                    onChange={(e) => setSnapshotFormat(e.target.value as "png" | "svg")}
                    style={{ minWidth: "110px" }}
                  >
                    <option value="png">PNG</option>
                    <option value="svg">SVG</option>
                  </SettingSelect>
                </SettingRow>

                <PauseButton
                  $paused={false}
                  onClick={handleSnapshot}
                  style={{ width: "100%", marginTop: "8px" }}
                >
                  Save snapshot
                </PauseButton>
              </CollapsibleBody>
            )}
          </Section>

          {sourceMode === "file" && (
            <>
              <Section>
                <SectionTitle $fileMode>File selection</SectionTitle>
                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Choose files...</SettingLabel>
                  </SettingLabelContainer>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="file"
                      accept=".c64,.napt"
                      multiple
                      style={{
                        display: "none",
                      }}
                      id="fileInput"
                      onChange={(e) => {
                        if (!e.target.files) return;
                        setSelectedFiles(
                          Array.from(e.target.files).map((file) => ({
                            name: file.name,
                            file,
                          })),
                        );

                        setTimeout(() => {
                          const btn = stitchButtonRef.current;
                          if (btn) {
                            btn.focus();
                            if (window.focus) window.focus();
                            btn.style.transform = "translateZ(0)";
                            void btn.offsetWidth;
                            btn.style.transform = "";
                          }
                        }, 50);
                      }}
                    />
                    <PauseButton
                      $paused={false}
                      onClick={() => document.getElementById("fileInput")?.click()}
                      style={{
                        flex: "none",
                        fontSize: "11px",
                        padding: "8px 12px",
                      }}
                    >
                      Browse
                    </PauseButton>
                  </div>
                </SettingRow>
              </Section>

              {selectedFiles.length > 0 && (
                <>
                  <Section>
                    <SectionTitle $fileMode>Selected files ({selectedFiles.length})</SectionTitle>
                    {selectedFiles.map((file, index) => (
                      <SettingRow key={index}>
                        <SettingLabelContainer>
                          <SettingLabel
                            style={{
                              fontSize: "11px",
                              maxWidth: "240px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {file.name}
                          </SettingLabel>
                        </SettingLabelContainer>
                        <PauseButton
                          $paused={false}
                          onClick={() =>
                            setSelectedFiles(selectedFiles.filter((_, i) => i !== index))
                          }
                          style={{
                            flex: "none",
                            fontSize: "10px",
                            padding: "4px 8px",
                            background: "transparent",
                          }}
                        >
                          Remove
                        </PauseButton>
                      </SettingRow>
                    ))}
                  </Section>

                  <Section>
                    {stitchStatus && (
                      <div
                        style={{
                          marginBottom: "8px",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          fontSize: "11px",
                          color: stitchStatus.startsWith("Stitching failed")
                            ? "#f87171"
                            : "#a3e635",
                          backgroundColor: stitchStatus.startsWith("Stitching failed")
                            ? "rgba(248,113,113,0.08)"
                            : "rgba(163,230,53,0.08)",
                          border: `1px solid ${stitchStatus.startsWith("Stitching failed") ? "rgba(248,113,113,0.2)" : "rgba(163,230,53,0.2)"}`,
                        }}
                      >
                        {stitchStatus}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <PauseButton
                          $paused={false}
                          ref={stitchButtonRef}
                          onClick={onStitch}
                          style={{ flex: 1 }}
                        >
                          Stitch spectrum
                        </PauseButton>
                        <PauseButton
                          $paused={false}
                          onClick={() => onClear()}
                          style={{ flex: 1, background: "transparent" }}
                        >
                          Clear
                        </PauseButton>
                      </div>
                      <PauseButton
                        $paused={isStitchPaused}
                        onClick={onStitchPauseToggle}
                        style={{ width: "100%" }}
                      >
                        {isStitchPaused ? "Play" : "Pause"}
                      </PauseButton>
                    </div>
                  </Section>

                  {selectedNaptFile && (
                    <Section>
                      <SectionTitle $fileMode>NAPT metadata</SectionTitle>
                      <SettingRow>
                        <SettingLabelContainer>
                          <SettingLabel>File</SettingLabel>
                        </SettingLabelContainer>
                        <SettingValue>{selectedNaptFile.name}</SettingValue>
                      </SettingRow>
                      <SettingRow>
                        <SettingLabelContainer>
                          <SettingLabel>Status</SettingLabel>
                        </SettingLabelContainer>
                        <SettingValue>
                          {naptMetadata
                            ? "Unlocked"
                            : naptMetadataError
                              ? naptMetadataError
                              : "Loading..."}
                        </SettingValue>
                      </SettingRow>
                      {naptMetadata && (
                        <>
                          <SettingRow>
                            <SettingLabelContainer>
                              <SettingLabel>Sample rate</SettingLabel>
                            </SettingLabelContainer>
                            <SettingValue>
                              {typeof naptMetadata.sample_rate === "number"
                                ? `${(naptMetadata.sample_rate / 1_000_000).toFixed(3)} MHz`
                                : "—"}
                            </SettingValue>
                          </SettingRow>
                          <SettingRow>
                            <SettingLabelContainer>
                              <SettingLabel>Center</SettingLabel>
                            </SettingLabelContainer>
                            <SettingValue>
                              {typeof naptMetadata.center_frequency === "number"
                                ? `${naptMetadata.center_frequency.toFixed(3)} MHz`
                                : "—"}
                            </SettingValue>
                          </SettingRow>
                          <SettingRow>
                            <SettingLabelContainer>
                              <SettingLabel>Range</SettingLabel>
                            </SettingLabelContainer>
                            <SettingValue>
                              {Array.isArray(naptMetadata.frequency_range)
                                ? `${naptMetadata.frequency_range[0].toFixed(3)}-${naptMetadata.frequency_range[1].toFixed(3)} MHz`
                                : "—"}
                            </SettingValue>
                          </SettingRow>
                          <SettingRow>
                            <SettingLabelContainer>
                              <SettingLabel>FFT</SettingLabel>
                            </SettingLabelContainer>
                            <SettingValue>
                              {naptMetadata.fft?.size ? naptMetadata.fft.size : "—"}
                              {naptMetadata.fft?.window ? ` / ${naptMetadata.fft.window}` : ""}
                            </SettingValue>
                          </SettingRow>
                          <SettingRow>
                            <SettingLabelContainer>
                              <SettingLabel>Timestamp</SettingLabel>
                            </SettingLabelContainer>
                            <SettingValue>{naptMetadata.timestamp_utc || "—"}</SettingValue>
                          </SettingRow>
                        </>
                      )}
                    </Section>
                  )}
                </>
              )}
            </>
          )}

          {sourceMode === "live" && (
            <Section>
              <SectionTitle>Signal areas of interest</SectionTitle>
              {(Array.isArray(spectrumFrames) && spectrumFrames.length > 0
                ? spectrumFrames
                : [
                  { id: "frame_a", label: "A", min_mhz: 0.0, max_mhz: 4.47, description: "" },
                  { id: "frame_b", label: "B", min_mhz: 24.72, max_mhz: 29.88, description: "" },
                ]
              ).map((frame) => {
                const label = frame.label;
                const min = frame.min_mhz;
                const max = frame.max_mhz;
                const span = max - min;
                const window = Math.min(3.2, Math.max(0.2, span));
                return (
                  <FrequencyRangeSlider
                    key={frame.id}
                    label={label}
                    minFreq={min}
                    maxFreq={max}
                    visibleMin={min}
                    visibleMax={min + window}
                    isActive={activeSignalArea === label}
                    onActivate={() => onSignalAreaChange?.(label)}
                    onRangeChange={label === "A" ? handleAreaARangeChange : handleAreaBRangeChange}
                    isDeviceConnected={deviceState === "connected"}
                    externalFrequencyRange={activeSignalArea === label ? frequencyRange : undefined}
                  />
                );
              })}
            </Section>
          )}

          <Section>
            <SectionTitle>Signal Features</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>
                  N-APT
                  <span role="img" aria-label="brain" style={{ marginLeft: "6px" }}>
                    🧠
                  </span>
                </SettingLabel>
                <InfoPopover
                  title="N-APT"
                  content="N-APT stands for: Neuro Automatic Picture Transmission. These radio waves are modulated akin to APT signals (unknown reasons at this time) but unique in their ability to intercept, process and alter the brain and nervous system.<br /><br />Through LF/HF frequencies (frequencies that survive attenuation of the skull and/or body; and lose less energy with longer distances/obstacles), it functions from triangulation, heterodyning (it's key feature which ensures bioelectrical reception), phase shifting, center frequencies, impedance & endpoint signals processing (suspected as Kaiser, Bayes' Theorem/Posterior Probability, etc.).<br /><br />It is an unprecedented technology with nascent efforts to decipher its modulation and content."
                />
              </SettingLabelContainer>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <SettingValue>{deviceState === "connected" ? "Yes" : "No"}</SettingValue>
                <PauseButton
                  $paused={false}
                  onClick={() => { }}
                  disabled={!isConnected || deviceState !== "connected"}
                  style={{
                    flex: "none",
                    fontSize: "11px",
                    padding: "6px 12px",
                    minWidth: "80px",
                    opacity: !isConnected || deviceState !== "connected" ? 0.5 : 1,
                    cursor: !isConnected || deviceState !== "connected" ? "not-allowed" : "pointer",
                  }}
                >
                  Classify?
                </PauseButton>
              </div>
            </SettingRow>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Heterodyned?</SettingLabel>
                <InfoPopover
                  title="Heterodyning Detection"
                  content="Advanced frequency analysis to detect heterodyning patterns in the signal using machine learning."
                />
              </SettingLabelContainer>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <SettingValue>No</SettingValue>
                <PauseButton
                  $paused={false}
                  onClick={() => {
                    // TODO: Implement heterodyning detection
                    console.log("Verify heterodyning clicked");
                  }}
                  disabled={!isConnected || deviceState !== "connected"}
                  style={{
                    fontSize: "11px",
                    padding: "6px 12px",
                    minWidth: "80px",
                    opacity: !isConnected || deviceState !== "connected" ? 0.5 : 1,
                    cursor: !isConnected || deviceState !== "connected" ? "not-allowed" : "pointer",
                  }}
                >
                  Verify
                </PauseButton>
              </div>
            </SettingRow>
          </Section>

          <Section>
            <SectionTitle>Signal display</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Sample Size</SettingLabel>
                <InfoPopover
                  title="Sample Size (Bandwidth)"
                  content="Radio signal bandwidth capacity. Determines the range of frequencies that can be intercepted and processed from transmissions."
                />
              </SettingLabelContainer>
              <SettingValue>
                {sourceMode === "file"
                  ? fileCapturedRange
                    ? `${(fileCapturedRange.max - fileCapturedRange.min).toFixed(2)}MHz`
                    : "No files"
                  : `${(maxSampleRate / 1000000).toFixed(1)}MHz`}
              </SettingValue>
            </SettingRow>
            {sourceMode === "file" && fileCapturedRange && (
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>Captured Range</SettingLabel>
                  <InfoPopover
                    title="Captured Frequency Range"
                    content="The frequency range covered by the selected I/Q capture files, derived from the center frequencies encoded in the filenames."
                  />
                </SettingLabelContainer>
                <SettingValue>
                  {fileCapturedRange.min.toFixed(2)}MHz to {fileCapturedRange.max.toFixed(2)}MHz
                </SettingValue>
              </SettingRow>
            )}
            {sourceMode === "live" ? (
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>Frame Rate</SettingLabel>
                  <InfoPopover
                    title="Frame Rate"
                    content={`Signal processing speed. Higher rates provide more real-time analysis of transmissions. Current maximum theoretical rate: ${maxFrameRate} fps based on current FFT size and bandwidth capacity.`}
                  />
                </SettingLabelContainer>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <SettingInput
                    type="number"
                    value={fftFrameRate}
                    onChange={(e) => {
                      const val = Math.max(
                        1,
                        Math.min(maxFrameRate, Math.floor(Number(e.target.value) || 1)),
                      );
                      setFftFrameRate(val);
                      sendCurrentSettings({ frameRate: val });
                      scheduleCoupledAdjustment("frameRate", fftSize, val);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      e.stopPropagation();
                      const step = 1; // Always use 1-frame rate steps for precision
                      const delta = e.key === "ArrowUp" ? step : -step;
                      const next = Math.max(
                        1,
                        Math.min(maxFrameRate, Math.floor((fftFrameRate || 0) + delta)),
                      );
                      setFftFrameRate(next);
                      sendCurrentSettings({ frameRate: next });
                      scheduleCoupledAdjustment("frameRate", fftSize, next);
                    }}
                    min="1"
                    max={maxFrameRate}
                  />
                  <span style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}>fps</span>
                </div>
              </SettingRow>
            ) : (
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>Frame Rate</SettingLabel>
                </SettingLabelContainer>
                <SettingValue>4 fps</SettingValue>
              </SettingRow>
            )}
            {sourceMode === "live" ? (
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>FFT Size</SettingLabel>
                  <InfoPopover
                    title="FFT Size"
                    content="Frequency resolution. Larger sizes provide better detection of specific signal patterns in transmissions but reduce processing speed."
                  />
                </SettingLabelContainer>
                <SettingSelect
                  value={fftSize}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setFftSize(val);
                    sendCurrentSettings({ fftSize: val });
                    scheduleCoupledAdjustment("fftSize", val, fftFrameRate);
                  }}
                >
                  <option value={8192}>8192</option>
                  <option value={16384}>16384</option>
                  <option value={32768}>32768</option>
                  <option value={65536}>65536</option>
                  <option value={131072}>131072</option>
                  <option value={262144}>262144</option>
                </SettingSelect>
              </SettingRow>
            ) : (
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>FFT Size</SettingLabel>
                </SettingLabelContainer>
                <SettingValue>1024</SettingValue>
              </SettingRow>
            )}
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>FFT Window</SettingLabel>
                <InfoPopover
                  title="FFT Window"
                  content="Signal filtering. Different windows optimize for detecting specific types of patterns and interactions in transmissions."
                />
              </SettingLabelContainer>
              <SettingSelect
                value={fftWindow}
                onChange={(e) => {
                  const val = e.target.value;
                  setFftWindow(val);
                  sendCurrentSettings({ fftWindow: val });
                }}
              >
                <option value="Rectangular">Rectangular</option>
                <option value="Hanning">Hanning</option>
                <option value="Hamming">Hamming</option>
                <option value="Blackman">Blackman</option>
                <option value="Nuttall">Nuttall</option>
              </SettingSelect>
            </SettingRow>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Temporal Resolution</SettingLabel>
                <InfoPopover
                  title="Display Temporal Resolution"
                  content="Signal visualization precision. Low blends signal patterns, medium shows averaged activity, high displays exact signal interactions with sharp transitions, with the ability to see patterns (like dots) in the waterfall as the signal rises and falls sharply."
                />
              </SettingLabelContainer>
              <SettingSelect
                value={temporalResolution}
                onChange={(e) => {
                  onDisplayTemporalResolutionChange?.(e.target.value as "low" | "medium" | "high");
                }}
                style={{ minWidth: "120px" }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </SettingSelect>
            </SettingRow>
          </Section>

          <Section>
            <SectionTitle>Source Settings</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>PPM</SettingLabel>
                <InfoPopover
                  title="PPM Correction"
                  content="Frequency alignment. Parts per million correction for precise tuning to signal frequencies."
                />
              </SettingLabelContainer>
              <SettingInput
                type="number"
                value={sourceMode === "file" ? stitchSourceSettings.ppm : ppm}
                onChange={(e) => {
                  const raw = e.target.value;
                  const val = raw === "" ? 0 : parseInt(raw, 10) || 0;
                  if (sourceMode === "file") {
                    onStitchSourceSettingsChange({ ...stitchSourceSettings, ppm: val });
                  } else {
                    setPpm(val);
                    sendCurrentSettings({ ppm: val });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.key === "ArrowUp" ? 1 : -1;
                  if (sourceMode === "file") {
                    onStitchSourceSettingsChange({
                      ...stitchSourceSettings,
                      ppm: (stitchSourceSettings.ppm || 0) + delta,
                    });
                  } else {
                    const next = (ppm || 0) + delta;
                    setPpm(next);
                    sendCurrentSettings({ ppm: next });
                  }
                }}
                step="1"
                style={{ width: "60px" }}
              />
            </SettingRow>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Gain</SettingLabel>
                <InfoPopover
                  title="Gain Setting"
                  content="Signal amplification. Increases sensitivity to weak transmissions but may introduce interference from other signals."
                />
              </SettingLabelContainer>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <SettingInput
                  type="number"
                  step="1"
                  value={sourceMode === "file" ? stitchSourceSettings.gain : gain}
                  onChange={(e) => {
                    const raw = Math.round(Number(e.target.value));
                    if (sourceMode === "file") {
                      onStitchSourceSettingsChange({ ...stitchSourceSettings, gain: raw || 0 });
                    } else {
                      const val = clampGain(Number.isFinite(raw) ? raw : 0);
                      setGain(val);
                      sendCurrentSettings({ gain: val });
                    }
                  }}
                  min="0"
                  max={sourceMode === "file" ? undefined : "49.6"}
                  style={{ width: "60px", MozAppearance: "textfield", WebkitAppearance: "none" } as React.CSSProperties}
                />
                <span style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}>dB</span>
              </div>
            </SettingRow>
            {sourceMode === "live" && (
              <>
                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Tuner AGC</SettingLabel>
                    <InfoPopover
                      title="Tuner AGC"
                      content="Tuner Automatic Gain Control. Automatically adjusts the tuner gain for optimal signal reception. Works alongside manual gain setting. Only one AGC mode can be active at a time."
                    />
                  </SettingLabelContainer>
                  <ToggleSwitch $disabled={!isConnected}>
                    <ToggleSwitchInput
                      type="checkbox"
                      checked={tunerAGC}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setTunerAGC(enabled);
                        if (enabled) {
                          setRtlAGC(false);
                          sendCurrentSettings({ tunerAGC: true, rtlAGC: false });
                        } else {
                          sendCurrentSettings({ tunerAGC: false });
                        }
                      }}
                      disabled={!isConnected}
                    />
                    <ToggleSwitchSlider $disabled={!isConnected} />
                  </ToggleSwitch>
                </SettingRow>
                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>RTL AGC</SettingLabel>
                    <InfoPopover
                      title="RTL AGC"
                      content="RTL Automatic Gain Control. Automatically adjusts the RTL2832 gain for optimal signal reception. Works alongside manual gain setting. Only one AGC mode can be active at a time."
                    />
                  </SettingLabelContainer>
                  <ToggleSwitch $disabled={!isConnected}>
                    <ToggleSwitchInput
                      type="checkbox"
                      checked={rtlAGC}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setRtlAGC(enabled);
                        if (enabled) {
                          setTunerAGC(false);
                          sendCurrentSettings({ rtlAGC: true, tunerAGC: false });
                        } else {
                          sendCurrentSettings({ rtlAGC: false });
                        }
                      }}
                      disabled={!isConnected}
                    />
                    <ToggleSwitchSlider $disabled={!isConnected} />
                  </ToggleSwitch>
                </SettingRow>
              </>
            )}
          </Section>
        </>
      )}

      {activeTab === "draw" && (
        <DrawMockNAPTSidebar
          drawParams={drawParams}
          onDrawParamsChange={onDrawParamsChange}
        />
      )}
    </SidebarContainer>
  );
};

export default Sidebar;

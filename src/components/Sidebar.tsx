import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import InfoPopover from "@n-apt/components/InfoPopover";
import FrequencyRangeSlider from "@n-apt/components/FrequencyRangeSlider";
import type { SDRSettings, DeviceState, DeviceLoadingReason } from "@n-apt/hooks/useWebSocket";

const SidebarContainer = styled.aside`
  width: 360px;
  min-width: 360px;
  height: 100vh;
  background-color: #0d0d0d;
  border-right: 1px solid #1a1a1a;
  display: flex;
  flex-direction: column;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
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
    props.$color ? props.$color :
    props.$loading ? "#ffaa00" : 
    props.$connected ? "#00d4ff" : "#ff4444"};
  box-shadow: ${(props) => {
    const c = props.$color ? props.$color :
      props.$loading ? "#ffaa00" :
      props.$connected ? "#00d4ff" : "#ff4444";
    return `0 0 8px ${c}`;
  }};
  flex-shrink: 0;
  ${(props) => props.$loading && `
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
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: #444;
  }
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
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  width: 50px;
  text-align: center;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &[type="number"] {
    -moz-appearance: textfield;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
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
  isConnected: boolean;
  isAuthenticated: boolean;
  authState: string;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
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
}

const Sidebar: React.FC<SidebarProps> = ({
  isConnected,
  isAuthenticated,
  authState,
  deviceState,
  deviceLoadingReason,
  isPaused,
  serverPaused,
  backend,
  deviceInfo,
  activeTab,
  onTabChange,
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
}) => {
  // Live retune toggle state (default on)
  const liveRetune = true;
  void liveRetune;

  // FFT settings defaults tuned for realistic 3.2 Msps RTL-SDR throughput
  const [fftSize, setFftSize] = useState(32768);
  const [fftWindow, setFftWindow] = useState("Rectangular");
  const [fftFrameRate, setFftFrameRate] = useState(30);
  const [maxSampleRate, setMaxSampleRate] = useState(3200000); // Default 3.2MHz
  const [gain, setGain] = useState(49.6);
  const [tunerAGC, setTunerAGC] = useState(false);
  const [rtlAGC, setRtlAGC] = useState(false);

  const clampGain = useCallback((val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(49.6, val));
  }, []);
  const [ppm, setPpm] = useState(1);

  const temporalResolution = displayTemporalResolution ?? "medium";

  // Calculate maximum theoretical frame rate based on FFT size and sample rate
  const maxFrameRate = useMemo(() => {
    const theoretical = maxSampleRate / fftSize;
    return Math.max(1, Math.floor(Math.min(theoretical, 60))); // Cap at 60Hz screen refresh rate
  }, [fftSize, maxSampleRate]);

  // Extract max sample rate from device info when it changes
  useEffect(() => {
    if (deviceInfo) {
      // Parse "max: X Hz" from device info string
      const match = deviceInfo.match(/max:\s*(\d+)\s*Hz/);
      if (match) {
        const rate = parseInt(match[1], 10);
        setMaxSampleRate(rate);
      } else {
        // Fallback: try to parse sample rate for mock mode
        const sampleMatch = deviceInfo.match(/Sample Rate:\s*(\d+)\s*Hz/);
        if (sampleMatch) {
          const rate = parseInt(sampleMatch[1], 10);
          setMaxSampleRate(rate);
        }
      }
    }
  }, [deviceInfo]);

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
  }, [isConnected, deviceState, fftSize, fftWindow, fftFrameRate, gain, ppm, tunerAGC, rtlAGC, onSettingsChange]);

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
    let minFreq = Infinity;
    let maxFreq = -Infinity;
    for (const f of selectedFiles) {
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

  // Minimal sidebar mode: only show connection status and auth state
  if (!isAuthenticated) {
    const authStatusText = (() => {
      switch (authState) {
        case "connecting": return "Connecting to server...";
        case "awaiting_challenge": return "Establishing secure channel...";
        case "ready": return "Awaiting authentication...";
        case "authenticating": return "Verifying credentials...";
        case "failed": return "Authentication failed";
        case "timeout": return "Authentication timed out";
        case "success": return "Authenticated — starting stream...";
        default: return "Awaiting authentication...";
      }
    })();

    return (
      <SidebarContainer>
        <Section>
          <SectionTitle>Connection</SectionTitle>
          <ConnectionStatusContainer>
            <ConnectionStatus>
              <StatusDot $connected={isConnected} $loading={authState === "authenticating" || authState === "awaiting_challenge"} />
              <StatusText>
                {!isConnected ? "Disconnected" : "Connected to server"}
              </StatusText>
            </ConnectionStatus>
          </ConnectionStatusContainer>
        </Section>

        <Section>
          <SectionTitle>Authentication</SectionTitle>
          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Status</SettingLabel>
            </SettingLabelContainer>
            <SettingValue style={{ 
              color: authState === "failed" || authState === "timeout" ? "#ff4444" 
                   : authState === "success" ? "#00d4ff" 
                   : "#888",
              fontSize: "11px",
            }}>
              {authStatusText}
            </SettingValue>
          </SettingRow>
          {backend && (
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Backend</SettingLabel>
              </SettingLabelContainer>
              <SettingValue>{backend === "rtl-sdr" ? "RTL-SDR" : "Mock"}</SettingValue>
            </SettingRow>
          )}
        </Section>
      </SidebarContainer>
    );
  }

  return (
    <SidebarContainer>
      <TabContainer>
        <Tab
          $active={activeTab === "visualizer"}
          onClick={() => onTabChange("visualizer")}
        >
          N-APT visualizer
        </Tab>
        <Tab
          $active={activeTab === "analysis"}
          onClick={() => onTabChange("analysis")}
        >
          Decode N-APT with ML
        </Tab>
      </TabContainer>

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
                      ? (deviceLoadingReason === "restart" ? "Restarting device..." : "Loading device...")
                      : deviceState === "stale"
                        ? "Device stream frozen"
                        : deviceState === "connected"
                          ? "Connected to server and device"
                          : "Connected to server but device not connected"}
                </StatusText>
              </ConnectionStatus>

              {isConnected && (
                (deviceState === "stale") ? (
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
                ) : (deviceState === "loading" && deviceLoadingReason === "restart") ? (
                  <PauseButton
                    $paused={false}
                    onClick={() => {}}
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
                ) : (deviceState === "loading") ? (
                  <PauseButton
                    $paused={false}
                    onClick={() => {}}
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
                )
              )}
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
                <option value="file" style={{ color: "#d9aa34" }}>File Selection</option>
              </SettingSelect>
            </SettingRow>
            {sourceMode === "live" && (
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>Status</SettingLabel>
                </SettingLabelContainer>
                <SettingValue>
                  {!isConnected
                    ? "Unavailable"
                    : backend === "rtl-sdr"
                      ? deviceState === "connected"
                        ? serverPaused
                          ? "Inactive"
                          : "Active"
                        : "Unavailable"
                      : serverPaused
                        ? "Inactive"
                        : "Active"}
                </SettingValue>
              </SettingRow>
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
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <input
                      type="file"
                      accept=".c64"
                      multiple
                      style={{
                        display: "none",
                      }}
                      id="fileInput"
                      onChange={(e) => {
                        if (!e.target.files) return
                        setSelectedFiles(
                          Array.from(e.target.files).map((file) => ({
                            name: file.name,
                            file,
                          })),
                        )

                        setTimeout(() => {
                          const btn = stitchButtonRef.current
                          if (btn) {
                            btn.focus()
                            if (window.focus) window.focus()
                            btn.style.transform = 'translateZ(0)'
                            void btn.offsetWidth
                            btn.style.transform = ''
                          }
                        }, 50)
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
                    <SectionTitle $fileMode>
                      Selected files ({selectedFiles.length})
                    </SectionTitle>
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
                            setSelectedFiles(
                              selectedFiles.filter((_, i) => i !== index),
                            )
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
                      <div style={{
                        marginBottom: "8px",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        color: stitchStatus.startsWith("Stitching failed") ? "#f87171" : "#a3e635",
                        backgroundColor: stitchStatus.startsWith("Stitching failed") ? "rgba(248,113,113,0.08)" : "rgba(163,230,53,0.08)",
                        border: `1px solid ${stitchStatus.startsWith("Stitching failed") ? "rgba(248,113,113,0.2)" : "rgba(163,230,53,0.2)"}`,
                      }}>
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
                </>
              )}
            </>
          )}

          {sourceMode === "live" && (
            <Section>
              <SectionTitle>Signal areas of interest</SectionTitle>
              <FrequencyRangeSlider
                label="A"
                minFreq={0}
                maxFreq={4.47}
                visibleMin={0}
                visibleMax={3.2}
                isActive={activeSignalArea === "A"}
                onActivate={() => onSignalAreaChange?.("A")}
                onRangeChange={handleAreaARangeChange}
                isDeviceConnected={deviceState === "connected"}
                externalFrequencyRange={activeSignalArea === "A" ? frequencyRange : undefined}
              />
              <FrequencyRangeSlider
                label="B"
                minFreq={24.72}
                maxFreq={29.88}
                visibleMin={26}
                visibleMax={28.2}
                isActive={activeSignalArea === "B"}
                onActivate={() => onSignalAreaChange?.("B")}
                onRangeChange={handleAreaBRangeChange}
                isDeviceConnected={deviceState === "connected"}
                externalFrequencyRange={activeSignalArea === "B" ? frequencyRange : undefined}
              />
              <SettingRow style={{ marginTop: "16px" }}>
                <SettingLabelContainer>
                  <SettingLabel>
                    Signal features
                    <span style={{ marginLeft: "4px", fontSize: "10px" }}>/</span>
                  </SettingLabel>
                  <InfoPopover
                    title="Signal Features"
                    content="Advanced frequency analysis to detect heterodyning patterns and other signal characteristics using machine learning."
                  />
                </SettingLabelContainer>
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
                    minWidth: "120px",
                    opacity: (!isConnected || deviceState !== "connected") ? 0.5 : 1,
                    cursor: (!isConnected || deviceState !== "connected") ? "not-allowed" : "pointer"
                  }}
                >
                  Verify heterodyning
                </PauseButton>
              </SettingRow>
            </Section>
          )}

          <Section>
            <SectionTitle>Signal type</SectionTitle>
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
                  onClick={() => {}}
                  disabled={!isConnected || deviceState !== "connected"}
                  style={{
                    flex: "none",
                    fontSize: "11px",
                    padding: "6px 12px",
                    minWidth: "80px",
                    opacity: (!isConnected || deviceState !== "connected") ? 0.5 : 1,
                    cursor: (!isConnected || deviceState !== "connected") ? "not-allowed" : "pointer"
                  }}
                >
                  Classify?
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
                  : `${(maxSampleRate / 1000000).toFixed(1)}MHz (max)`}
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
                <div
                  style={{ display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <SettingInput
                    type="number"
                    value={fftFrameRate}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(maxFrameRate, Math.floor(Number(e.target.value) || 1)));
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
                      const next = Math.max(1, Math.min(maxFrameRate, Math.floor((fftFrameRate || 0) + delta)));
                      setFftFrameRate(next);
                      sendCurrentSettings({ frameRate: next });
                      scheduleCoupledAdjustment("frameRate", fftSize, next);
                    }}
                    min="1"
                    max={maxFrameRate}
                  />
                  <span
                    style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}
                  >
                    fps
                  </span>
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
                  onDisplayTemporalResolutionChange?.(
                    e.target.value as "low" | "medium" | "high",
                  );
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
                    onStitchSourceSettingsChange({ ...stitchSourceSettings, ppm: (stitchSourceSettings.ppm || 0) + delta });
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
                  value={sourceMode === "file" ? stitchSourceSettings.gain : gain}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (sourceMode === "file") {
                      onStitchSourceSettingsChange({ ...stitchSourceSettings, gain: raw || 0 });
                    } else {
                      const val = clampGain(Number.isFinite(raw) ? raw : 0);
                      setGain(val);
                      sendCurrentSettings({ gain: val });
                    }
                  }}
                  step="0.1"
                  min="0"
                  max={sourceMode === "file" ? undefined : "49.6"}
                  style={{ width: "60px" }}
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

    </SidebarContainer>
  );
};

export default Sidebar;

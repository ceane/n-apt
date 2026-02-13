import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import InfoPopover from "@n-apt/components/InfoPopover";
import FrequencyRangeSlider from "@n-apt/components/FrequencyRangeSlider";
import type { SDRSettings } from "@n-apt/hooks/useWebSocket";

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

const StatusDot = styled.div<{ $connected: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${(props) => (props.$connected ? "#00d4ff" : "#ff4444")};
  box-shadow: ${(props) =>
    props.$connected ? "0 0 8px #00d4ff" : "0 0 8px #ff4444"};
  flex-shrink: 0;
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

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
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
`;

interface SidebarProps {
  isConnected: boolean;
  isDeviceConnected: boolean;
  isPaused: boolean;
  serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  activeSignalArea: string;
  onSignalAreaChange: (area: string) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
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
}

const Sidebar = ({
  isConnected,
  isDeviceConnected,
  isPaused,
  serverPaused,
  backend,
  deviceInfo,
  activeTab,
  onTabChange,
  activeSignalArea,
  onSignalAreaChange,
  onFrequencyRangeChange,
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
}: SidebarProps) => {
  // Live retune toggle state (default on)
  const liveRetune = true;
  void liveRetune;

  // FFT settings defaults tuned for realistic 3.2 Msps RTL-SDR throughput
  const [fftSize, setFftSize] = useState(32768);
  const [fftWindow, setFftWindow] = useState("Rectangular");
  const [fftFrameRate, setFftFrameRate] = useState(30);
  const [maxSampleRate, setMaxSampleRate] = useState(3200000); // Default 3.2MHz
  const [gain, setGain] = useState(49.6);
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
    if (isConnected && isDeviceConnected && !initialSettingsSent.current) {
      initialSettingsSent.current = true;
      onSettingsChange?.({
        fftSize,
        fftWindow,
        frameRate: fftFrameRate,
        gain,
        ppm,
      });
    }
    if (!isConnected) {
      initialSettingsSent.current = false;
    }
  }, [isConnected, isDeviceConnected, fftSize, fftWindow, fftFrameRate, gain, ppm, onSettingsChange]);

  // Helper to send settings on any control change
  const sendCurrentSettings = useCallback(
    (overrides: Partial<SDRSettings> = {}) => {
      onSettingsChange?.({
        fftSize,
        fftWindow,
        frameRate: fftFrameRate,
        gain,
        ppm,
        ...overrides,
      });
    },
    [fftSize, fftWindow, fftFrameRate, gain, ppm, onSettingsChange],
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



  // Stitcher state (using props to sync with App component)
  const setSelectedFiles = onSelectedFilesChange;

  // Use refs to track last notified values to prevent excessive updates
  const lastNotifiedRangeRef = useRef({ min: 0, max: 3.2 });
  const stitchPointerDownFiredRef = useRef(false);
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

  return (
    <SidebarContainer>
      <TabContainer>
        <Tab
          $active={activeTab === "visualizer"}
          onClick={() => onTabChange("visualizer")}
        >
          Live N-APT visualizer
        </Tab>
        <Tab
          $active={activeTab === "stitcher"}
          onClick={() => onTabChange("stitcher")}
        >
          N-APT stitcher & I/Q replay
        </Tab>
        <Tab
          $active={activeTab === "analysis"}
          onClick={() => onTabChange("analysis")}
        >
          N-APT live deep analysis
        </Tab>
      </TabContainer>

      {activeTab === "visualizer" && (
        <>
          <ConnectionStatusContainer>
            <ConnectionStatus>
              <StatusDot $connected={isConnected && isDeviceConnected} />
              <StatusText>
                {!isConnected
                  ? "Disconnected"
                  : isDeviceConnected
                    ? "Connected to server and device"
                    : "Connected to server but device not connected"}
              </StatusText>
            </ConnectionStatus>

            {isConnected && (
              <PauseButton $paused={isPaused} onClick={onPauseToggle}>
                {isPaused ? "Resume" : "Pause"}
              </PauseButton>
            )}
          </ConnectionStatusContainer>

          <Section>
            <SectionTitle>Source</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>
                  {backend === "rtl-sdr" ? "RTL-SDR" : backend === "mock" ? "Mock" : "Source"}
                </SettingLabel>
                <InfoPopover
                  title="Source"
                  content="SDR (Software Defined Radio) device used for capturing and processing radio frequency signals."
                />
              </SettingLabelContainer>
              <SettingValue>
                {!isConnected
                  ? "Unavailable"
                  : backend === "rtl-sdr"
                    ? isDeviceConnected
                      ? serverPaused
                        ? "Inactive"
                        : "Active"
                      : "Unavailable"
                    : serverPaused
                      ? "Inactive"
                      : "Active"}
              </SettingValue>
            </SettingRow>
          </Section>

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
              isDeviceConnected={isDeviceConnected}
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
              isDeviceConnected={isDeviceConnected}
            />
          </Section>

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
                <SettingValue>{isDeviceConnected ? "Yes" : "No"}</SettingValue>
                <PauseButton
                  $paused={false}
                  onClick={() => {}}
                  disabled={!isConnected || !isDeviceConnected}
                  style={{
                    flex: "none",
                    fontSize: "11px",
                    padding: "6px 12px",
                    minWidth: "80px",
                    opacity: (!isConnected || !isDeviceConnected) ? 0.5 : 1,
                    cursor: (!isConnected || !isDeviceConnected) ? "not-allowed" : "pointer"
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
              <SettingValue>{(maxSampleRate / 1000000).toFixed(1)}MHz (max)</SettingValue>
            </SettingRow>
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
                  content="Signal visualization precision. Low blends signal patterns, medium shows averaged activity, high displays exact signal interactions with sharp transitions, with the ability to see patterns like dots and other patterns as the signal rises and falls sharply."
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
                value={ppm}
                onChange={(e) => {
                  const raw = e.target.value;
                  const val = raw === "" ? 0 : parseInt(raw, 10) || 0;
                  setPpm(val);
                  sendCurrentSettings({ ppm: val });
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.key === "ArrowUp" ? 1 : -1;
                  const next = (ppm || 0) + delta;
                  setPpm(next);
                  sendCurrentSettings({ ppm: next });
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
                  value={gain}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 0;
                    setGain(val);
                    sendCurrentSettings({ gain: val });
                  }}
                  step="0.1"
                  style={{ width: "60px" }}
                />
                <span style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}>dB</span>
              </div>
            </SettingRow>
            </Section>
        </>
      )}

      {activeTab === "stitcher" && (
        <>
          <Section>
            <SectionTitle>File selection</SectionTitle>
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

                    // After closing the native file picker, the first click can be swallowed.
                    // Focusing the action button makes the next interaction reliable.
                    setTimeout(() => {
                      const btn = stitchButtonRef.current
                      if (btn) {
                        btn.focus()
                        // In iframe environments (ChatGPT Atlas), also ensure the window is active
                        if (window.focus) window.focus()
                        // Force a layout/paint to ensure activation
                        btn.style.transform = 'translateZ(0)'
                        void btn.offsetWidth
                        btn.style.transform = ''
                      }
                    }, 50) // Slightly longer delay for iframe contexts
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
                <SectionTitle>Source settings</SectionTitle>
                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>Gain (dB)</SettingLabel>
                  </SettingLabelContainer>
                  <input
                    type="number"
                    value={stitchSourceSettings.gain}
                    onChange={(e) =>
                      onStitchSourceSettingsChange({
                        ...stitchSourceSettings,
                        gain: Number(e.target.value) || 0,
                      })
                    }
                    style={{
                      width: "100px",
                      background: "#111",
                      color: "#e6e6e6",
                      border: "1px solid #333",
                      borderRadius: "6px",
                      padding: "6px 8px",
                    }}
                  />
                </SettingRow>
                <SettingRow>
                  <SettingLabelContainer>
                    <SettingLabel>PPM</SettingLabel>
                  </SettingLabelContainer>
                  <input
                    type="number"
                    value={stitchSourceSettings.ppm}
                    onChange={(e) =>
                      onStitchSourceSettingsChange({
                        ...stitchSourceSettings,
                        ppm: Number(e.target.value) || 0,
                      })
                    }
                    style={{
                      width: "100px",
                      background: "#111",
                      color: "#e6e6e6",
                      border: "1px solid #333",
                      borderRadius: "6px",
                      padding: "6px 8px",
                    }}
                  />
                </SettingRow>
              </Section>

              <Section>
                <SectionTitle>
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
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <PauseButton
                      $paused={false}
                      ref={stitchButtonRef}
                      onPointerDown={() => {
                        stitchPointerDownFiredRef.current = true
                        onStitch()
                      }}
                      onClick={() => {
                        if (stitchPointerDownFiredRef.current) {
                          stitchPointerDownFiredRef.current = false
                          return
                        }
                        onStitch()
                      }}
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
                    {isStitchPaused ? "Resume" : "Pause"}
                  </PauseButton>
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </SidebarContainer>
  );
};

export default Sidebar;

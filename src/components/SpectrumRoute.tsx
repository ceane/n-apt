import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import styled from "styled-components";
import Sidebar from "@n-apt/components/sidebar/Sidebar";
import AuthenticationPrompt from "@n-apt/components/AuthenticationPrompt";
import type { AuthState } from "@n-apt/components/AuthenticationPrompt";
import { FFTCanvas } from "@n-apt/components";
import ClassificationControls from "@n-apt/components/ClassificationControls";
import Decode from "@n-apt/components/Decode";
import DrawMockNAPTChart from "@n-apt/components/DrawMockNAPTChart";
import FFTStitcherCanvas from "@n-apt/components/FFTStitcherCanvas";
import { useWebSocket, FrequencyRange, SpectrumFrame } from "@n-apt/hooks/useWebSocket";
import { deriveAesKey } from "@n-apt/crypto/webcrypto";
import {
  getStoredSession,
  validateSession,
  authenticateWithPassword,
  authenticateWithPasskey,
  registerPasskey,
  fetchAuthInfo,
  buildWsUrl,
  clearSession,
  type AuthInfo,
} from "@n-apt/services/auth";

// Types
type SourceMode = "live" | "file";
type SelectedFile = { name: string; file: File };

// Styled Components
const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #0a0a0a;
`;

const AppWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`;

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

interface SpectrumRouteProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isSidebarOpen: boolean;
  onAuthChange?: (isAuthenticated: boolean) => void;
  sidebarWrapper?: (sidebar: React.ReactNode) => React.ReactNode;
  showInternalTabs?: boolean;
}

export const SpectrumRoute: React.FC<SpectrumRouteProps> = ({
  activeTab,
  onTabChange,
  isSidebarOpen,
  onAuthChange,
  sidebarWrapper,
  showInternalTabs = true,
}) => {
  const [activeSignalArea, setActiveSignalArea] = useState("A");
  const [frequencyRange, setFrequencyRange] = useState<FrequencyRange>({
    min: 0.0,
    max: 3.2,
  });

  const [spectrumFrames, setSpectrumFrames] = useState<SpectrumFrame[]>([]);

  const defaultFrames = useMemo(() => {
    if (Array.isArray(spectrumFrames) && spectrumFrames.length > 0) return spectrumFrames;
    return [];
  }, [spectrumFrames]);

  const [displayTemporalResolution, setDisplayTemporalResolution] = useState<
    "low" | "medium" | "high"
  >("medium");

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [snapshotGridPreference, setSnapshotGridPreference] = useState(true);

  // When returning to the visualizer tab, force a resize event so canvases reflow.
  // Use rAF to ensure the CSS display change has been applied before measuring.
  useEffect(() => {
    if (activeTab === "visualizer") {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [activeTab]);

  const isVisualizer = activeTab === "visualizer";
  const isDraw = activeTab === "draw";
  const isAnalysis = activeTab === "analysis";

  // Draw signal parameters state
  const [drawParams, setDrawParams] = useState({
    spikeCount: 40,
    spikeWidth: 0.4,
    centerSpikeBoost: 4.9,
    floorAmplitude: 0.5,
    decayRate: 0.2,
    envelopeWidth: 10,
  });

  const [sourceMode, setSourceMode] = useState<SourceMode>("live");
  const [stitchStatus, setStitchStatus] = useState("");

  // ── Auth state (REST-based) ──────────────────────────────────────────
  const [authState, setAuthState] = useState<AuthState>("connecting");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [aesKey, setAesKey] = useState<CryptoKey | null>(null);
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [isInitialAuthCheck, setIsInitialAuthCheck] = useState(true);

  // When auth state changes, force canvas resize so FFTCanvas gets proper dimensions
  useEffect(() => {
    onAuthChange?.(isAuthenticated);
  }, [isAuthenticated, onAuthChange]);

  useEffect(() => {
    if (isAuthenticated) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [isAuthenticated]);

  // On mount: check for stored session, fetch auth info
  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const fetchAuthInfoWithTimeout = () =>
      new Promise<AuthInfo>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Backend timeout")), 3000);
        fetchAuthInfo()
          .then((info) => {
            clearTimeout(timeoutId);
            resolve(info);
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            reject(err);
          });
      });

    const scheduleAuthInfoRetry = (attempt = 1) => {
      if (cancelled) return;
      const delay = Math.min(5000, 500 * 2 ** (attempt - 1));
      retryTimeout = setTimeout(async () => {
        retryTimeout = null;
        try {
          const info = await fetchAuthInfoWithTimeout();
          if (!cancelled) {
            setHasPasskeys(info.has_passkeys);
          }
        } catch (error) {
          if (!cancelled) {
            console.debug("Auth info retry failed:", error);
            scheduleAuthInfoRetry(attempt + 1);
          }
        }
      }, delay);
    };

    const init = async () => {
      setAuthState("connecting");

      // Check for existing session first (fast path)
      const storedToken = getStoredSession();
      if (storedToken) {
        try {
          // Try to validate session immediately (no backend wait)
          const result = await validateSession(storedToken);
          if (!cancelled && result.valid) {
            setSessionToken(storedToken);
            // Derive AES key for decryption (uses default key for restored sessions)
            const key = await deriveAesKey("n-apt-dev-key");
            setAesKey(key);
            // Set authenticated state first, then auth state to prevent flashing
            setIsAuthenticated(true);
            setAuthState("ready"); // Set to ready instead of success to prevent prompt flash
            setIsInitialAuthCheck(false);
            return;
          }
        } catch (error) {
          // Session invalid, clear it and continue to auth info fetch
          console.warn("Session validation failed:", error);
          clearSession();
        }
      }

      // No valid session - fetch auth info (are passkeys registered?)
      try {
        const info = await fetchAuthInfoWithTimeout();
        if (!cancelled) {
          setHasPasskeys(info.has_passkeys);
          setAuthState("ready");
          setIsInitialAuthCheck(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Backend unavailable, showing auth prompt:", error);
          setAuthState("ready");
          setIsInitialAuthCheck(false);
          scheduleAuthInfoRetry();
        }
      }
    };

    init();
    return () => {
      cancelled = true;
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
    };
  }, []);

  // Ref for whole-range SVG snapshot (current waveform per window)
  const waveformRef = useRef<Float32Array | number[] | null>(null);
  const getCurrentWaveform = useCallback(() => waveformRef.current ?? null, []);

  // Build WS URL with session token
  const wsUrl = sessionToken ? buildWsUrl(sessionToken) : "";

  // WebSocket hook — only connects when authenticated
  const {
    isConnected,
    deviceState,
    deviceLoadingReason,
    backend,
    deviceInfo,
    maxSampleRateHz,
    serverPaused,
    data,
    captureStatus,
    spectrumFrames: wsSpectrumFrames,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
    sendRestartDevice,
    sendTrainingCommand,
    sendCaptureCommand,
  } = useWebSocket(wsUrl, aesKey, isAuthenticated);

  // Update waveform ref when data changes
  waveformRef.current = data?.waveform ?? null;

  // Auto-resume only on initial connection (server starts paused)
  const hasAutoResumedRef = useRef(false);
  useEffect(() => {
    if (isConnected && isVisualizer && serverPaused && !hasAutoResumedRef.current) {
      sendPauseCommand(false);
      setVisualizerPaused(false);
      hasAutoResumedRef.current = true;
    }
  }, [isConnected, isVisualizer, serverPaused, sendPauseCommand]);

  useEffect(() => {
    setSpectrumFrames(wsSpectrumFrames);
  }, [wsSpectrumFrames]);

  // Auth handlers
  const handlePasswordAuth = useCallback(async (password: string) => {
    setAuthState("authenticating");
    setAuthError(null);
    try {
      const result = await authenticateWithPassword(password);
      setSessionToken(result.token);
      // Derive AES key from the password for decryption
      const key = await deriveAesKey(password);
      setAesKey(key);
      setIsAuthenticated(true);
      setAuthState("ready"); // Set to ready instead of success to prevent prompt flash
      setIsInitialAuthCheck(false);
    } catch (e: any) {
      setAuthState("failed");
      setAuthError(e.message || "Authentication failed");
    }
  }, []);

  const handlePasskeyAuth = useCallback(async () => {
    setAuthState("authenticating");
    setAuthError(null);
    try {
      const result = await authenticateWithPasskey();
      setSessionToken(result.token);
      // For passkey auth, derive AES key from the default passkey
      // (server uses the same key for all sessions)
      const key = await deriveAesKey("n-apt-dev-key");
      setAesKey(key);
      setIsAuthenticated(true);
      setAuthState("ready"); // Set to ready instead of success to prevent prompt flash
      setIsInitialAuthCheck(false);
    } catch (e: any) {
      setAuthState("failed");
      setAuthError(e.message || "Passkey authentication failed");
    }
  }, []);

  const handleRegisterPasskey = useCallback(async () => {
    try {
      setAuthState("authenticating");
      await registerPasskey();
      // Refresh auth info to get updated hasPasskeys
      const info = await fetchAuthInfo();
      setHasPasskeys(info.has_passkeys);
      setAuthState("ready");
    } catch (e: any) {
      setAuthState("failed");
      setAuthError(e.message || "Passkey registration failed");
    }
  }, [setAuthState, setAuthError]);

  const [visualizerPaused, setVisualizerPaused] = useState(false);

  // Training capture state
  const [isTrainingCapturing, setIsTrainingCapturing] = useState(false);
  const [trainingCaptureLabel, setTrainingCaptureLabel] = useState<"target" | "noise" | null>(null);
  const [trainingCapturedSamples, setTrainingCapturedSamples] = useState(0);

  const handleTrainingCaptureStart = useCallback(
    (label: "target" | "noise") => {
      setIsTrainingCapturing(true);
      setTrainingCaptureLabel(label);
      sendTrainingCommand("start", label, activeSignalArea);
    },
    [sendTrainingCommand, activeSignalArea],
  );

  const handleTrainingCaptureStop = useCallback(() => {
    setIsTrainingCapturing(false);
    setTrainingCaptureLabel(null);
    setTrainingCapturedSamples((prev) => prev + 1);
    sendTrainingCommand("stop", trainingCaptureLabel ?? "target", activeSignalArea);
  }, [sendTrainingCommand, trainingCaptureLabel, activeSignalArea]);

  const [stitchTrigger, setStitchTrigger] = useState<number>(0);
  const [stitchSourceSettings, setStitchSourceSettings] = useState<{ gain: number; ppm: number }>({ gain: 0, ppm: 0 });
  const [isStitchPaused, setIsStitchPaused] = useState(true);

  const handleStitch = useCallback(() => {
    setIsStitchPaused(true);
    setStitchStatus("");
    setStitchTrigger((prev) => prev + 1);
  }, []);

  const handleClear = () => {
    setSelectedFiles([]);
  };

  // Pause server when leaving visualizer; stay paused when returning
  // User must manually hit Resume to restart the stream
  const prevIsVisualizerRef = useRef(isVisualizer);
  useEffect(() => {
    const prevIsVisualizer = prevIsVisualizerRef.current;
    prevIsVisualizerRef.current = isVisualizer;

    if (prevIsVisualizer !== isVisualizer) {
      if (!isVisualizer && isConnected) {
        // Leaving visualizer — pause the server stream
        sendPauseCommand(true);
        setVisualizerPaused(true);
      }
      // Returning to visualizer — stay paused, show cached snapshot
      // User must click Resume to restart

      setIsStitchPaused(!isVisualizer);
    }
  }, [isVisualizer, isConnected, sendPauseCommand]);

  const handleVisualizerPauseToggle = useCallback(() => {
    const newPausedState = !visualizerPaused;
    setVisualizerPaused(newPausedState);
    if (isConnected) {
      sendPauseCommand(newPausedState);
    }
  }, [visualizerPaused, isConnected, sendPauseCommand]);

  const handleSignalAreaChange = (area: string) => {
    // Only reset frequency range when switching to a different area
    if (area !== activeSignalArea) {
      setActiveSignalArea(area);
      const frame = defaultFrames.find((f: SpectrumFrame) => f.label.toLowerCase() === area.toLowerCase());
      if (frame) {
        const nextRange = { min: frame.min_mhz, max: Math.min(frame.max_mhz, frame.min_mhz + 3.2) };
        setFrequencyRange(nextRange);
        sendFrequencyRange(nextRange);
      }
    }
  };

  const handleFrequencyRangeChange = useCallback(
    (range: FrequencyRange) => {
      setFrequencyRange((prev) => {
        if (prev.min === range.min && prev.max === range.max) return prev;
        return range;
      });
      sendFrequencyRange(range);
    },
    [sendFrequencyRange],
  );

  return (
    <AppContainer>
      <AppWrapper>
        <ContentArea>
          {(() => {
            if (!isAuthenticated || !isSidebarOpen) return null;
            const sidebarNode = (
              <Sidebar
                isConnected={isConnected}
                isAuthenticated={isAuthenticated}
                deviceState={deviceState}
                deviceLoadingReason={deviceLoadingReason}
                isPaused={visualizerPaused}
                _serverPaused={serverPaused}
                backend={backend}
                deviceInfo={deviceInfo}
                maxSampleRateHz={maxSampleRateHz}
                sessionToken={sessionToken}
                aesKey={aesKey}
                captureStatus={captureStatus}
                onCaptureCommand={sendCaptureCommand}
                spectrumFrames={defaultFrames}
                activeTab={activeTab}
                onTabChange={onTabChange}
                drawParams={drawParams}
                onDrawParamsChange={setDrawParams}
                sourceMode={sourceMode}
                onSourceModeChange={setSourceMode}
                stitchStatus={stitchStatus}
                activeSignalArea={activeSignalArea}
                onSignalAreaChange={handleSignalAreaChange}
                onFrequencyRangeChange={handleFrequencyRangeChange}
                frequencyRange={frequencyRange}
                onPauseToggle={handleVisualizerPauseToggle}
                onSettingsChange={sendSettings}
                displayTemporalResolution={displayTemporalResolution}
                onDisplayTemporalResolutionChange={setDisplayTemporalResolution}
                selectedFiles={selectedFiles}
                onSelectedFilesChange={setSelectedFiles}
                stitchSourceSettings={stitchSourceSettings}
                onStitchSourceSettingsChange={setStitchSourceSettings}
                isStitchPaused={isStitchPaused}
                onStitchPauseToggle={() => setIsStitchPaused((p) => !p)}
                onStitch={handleStitch}
                onClear={handleClear}
                onRestartDevice={sendRestartDevice}
                snapshotGridPreference={snapshotGridPreference}
                onSnapshotGridPreferenceChange={setSnapshotGridPreference}
                fftWaveform={data?.waveform ?? null}
                getCurrentWaveform={getCurrentWaveform}
                centerFrequencyMHz={
                  (() => {
                    const min = frequencyRange?.min;
                    const max = frequencyRange?.max;
                    if (typeof min !== 'number' || typeof max !== 'number' ||
                      !Number.isFinite(min) || !Number.isFinite(max)) {
                      console.warn('Invalid frequency range:', { min, max, frequencyRange });
                      return 1.6; // Default center frequency
                    }
                    return (min + max) / 2;
                  })()
                }
                showInternalTabs={showInternalTabs}
              />
            );
            return sidebarWrapper ? sidebarWrapper(sidebarNode) : sidebarNode;
          })()}
          <MainContent>
            {isVisualizer && isInitialAuthCheck && (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#0a0a0a',
                padding: '40px',
                gap: '32px'
              }}>
                <h2 style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#e0e0e0',
                  margin: 0,
                  letterSpacing: '0.5px',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }}>
                  Initializing N-APT
                </h2>
                <p style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '12px',
                  color: '#666',
                  margin: 0,
                  textAlign: 'center',
                  maxWidth: '400px',
                  lineHeight: '1.6'
                }}>
                  Establishing secure connection and verifying session...
                </p>
                <style>{`
                  @keyframes pulse {
                    0% { opacity: 0.4; }
                    50% { opacity: 1; }
                    100% { opacity: 0.4; }
                  }
                `}</style>
              </div>
            )}
            {isVisualizer && !isAuthenticated && !isInitialAuthCheck && (
              <AuthenticationPrompt
                authState={authState}
                error={authError}
                hasPasskeys={hasPasskeys}
                onPasswordSubmit={handlePasswordAuth}
                onPasskeyAuth={handlePasskeyAuth}
                onRegisterPasskey={handleRegisterPasskey}
              />
            )}
            {isVisualizer && isAuthenticated && sourceMode === "live" && (
              <>
                {deviceState === "connected" && (
                  <ClassificationControls
                    isDeviceConnected={deviceState === "connected"}
                    activeSignalArea={activeSignalArea}
                    isCapturing={isTrainingCapturing}
                    captureLabel={trainingCaptureLabel}
                    capturedSamples={trainingCapturedSamples}
                    onCaptureStart={handleTrainingCaptureStart}
                    onCaptureStop={handleTrainingCaptureStop}
                  />
                )}
                <FFTCanvas
                  data={data}
                  frequencyRange={frequencyRange}
                  centerFrequencyMHz={
                    (() => {
                      const min = frequencyRange?.min;
                      const max = frequencyRange?.max;
                      if (typeof min !== 'number' || typeof max !== 'number' ||
                        !Number.isFinite(min) || !Number.isFinite(max)) {
                        return 1.6;
                      }
                      return (min + max) / 2;
                    })()
                  }
                  activeSignalArea={activeSignalArea}
                  isPaused={visualizerPaused}
                  isDeviceConnected={deviceState === "connected"}
                  onFrequencyRangeChange={handleFrequencyRangeChange}
                  displayTemporalResolution={displayTemporalResolution}
                  snapshotGridPreference={snapshotGridPreference}
                />
              </>
            )}
            {isVisualizer && isAuthenticated && sourceMode === "file" && (
              <FFTStitcherCanvas
                selectedFiles={selectedFiles}
                stitchTrigger={stitchTrigger}
                stitchSourceSettings={stitchSourceSettings}
                isPaused={isStitchPaused}
                onStitchStatus={setStitchStatus}
              />
            )}
            {isAnalysis && isAuthenticated && <Decode />}
            {isDraw && <DrawMockNAPTChart {...drawParams} />}
          </MainContent>
        </ContentArea>
      </AppWrapper>
    </AppContainer>
  );
};

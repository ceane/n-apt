import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import {
  BrowserRouter as Router,
  useLocation,
  useNavigate,
} from "react-router-dom"
import styled from "styled-components"
import Sidebar from "@n-apt/components/Sidebar"
import AuthenticationPrompt from "@n-apt/components/AuthenticationPrompt"
import type { AuthState } from "@n-apt/components/AuthenticationPrompt"
import { FFTCanvas, DrawMockNAPT } from "@n-apt/components"
import ClassificationControls from "@n-apt/components/ClassificationControls"
import HumanModelViewer from "@n-apt/components/HumanModelViewer"
import HotspotEditor from "@n-apt/components/HotspotEditor"
import FFTStitcherCanvas from "@n-apt/components/FFTStitcherCanvas"
import Decode from "@n-apt/components/Decode"
import { useWebSocket, FrequencyRange, SpectrumFrame } from "@n-apt/hooks/useWebSocket"
import { deriveAesKey } from "@n-apt/crypto/webcrypto"
import {
  getStoredSession,
  validateSession,
  authenticateWithPassword,
  authenticateWithPasskey,
  registerPasskey,
  fetchAuthInfo,
  buildWsUrl,
  clearSession,
} from "@n-apt/services/auth"

// Types
type MainTab = "Spectrum" | "DrawSignal" | "Model3D" | "HotspotEditor"
type SourceMode = "live" | "file"
type SelectedFile = { name: string; file: File }

const routeToMainTab = (path: string): MainTab => {
  switch (path) {
    case "/":
    case "/visualizer":
    case "/analysis":
      return "Spectrum"
    case "/draw-signal":
      return "DrawSignal"
    case "/3d-model":
      return "Model3D"
    case "/hotspot-editor":
      return "HotspotEditor"
    default:
      return "Spectrum"
  }
}

const routeToActiveTab = (path: string): string => {
  switch (path) {
    case "/":
    case "/visualizer":
      return "visualizer"
    case "/analysis":
      return "analysis"
    case "/hotspot-editor":
      return "hotspot-editor"
    default:
      return "visualizer"
  }
}

// Styled Components
const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #0a0a0a;
`

const AppWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const SidebarToggle = styled.button`
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 1000;
  background-color: #1a1a1a;
  border: 1px solid #00d4ff;
  border-radius: 6px;
  padding: 8px 12px;
  color: #00d4ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
`

const TabContainer = styled.div`
  display: flex;
  background-color: #0d0d0d;
  border-bottom: 1px solid #1a1a1a;
  padding: 0 20px;
`

const TabButton = styled.button<{ $isActive: boolean }>`
  padding: 12px 24px;
  background-color: ${props => props.$isActive ? "#1a1a1a" : "transparent"};
  border: none;
  border-bottom: 2px solid ${props => props.$isActive ? "#00d4ff" : "transparent"};
  color: ${props => props.$isActive ? "#00d4ff" : "#666"};
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
`

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`

// Inner App component that uses router hooks
export const AppContent: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()

  // Derive state from URL
  const mainTab = routeToMainTab(location.pathname)
  const activeTab = routeToActiveTab(location.pathname)

  const [activeSignalArea, setActiveSignalArea] = useState("A")
  const [frequencyRange, setFrequencyRange] = useState<FrequencyRange>({
    min: 0.0,
    max: 3.2,
  })

  const [spectrumFrames, setSpectrumFrames] = useState<SpectrumFrame[]>([])

  const defaultFrames = useMemo(() => {
    if (Array.isArray(spectrumFrames) && spectrumFrames.length > 0) return spectrumFrames
    return []
  }, [spectrumFrames])
  const [displayTemporalResolution, setDisplayTemporalResolution] = useState<
    "low" | "medium" | "high"
  >("medium")
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [snapshotGridPreference, setSnapshotGridPreference] = useState(true)

  // When returning to the visualizer tab, force a resize event so canvases reflow.
  // Use rAF to ensure the CSS display change has been applied before measuring.
  useEffect(() => {
    if (activeTab === "visualizer") {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"))
      })
    }
  }, [activeTab])

  const isVisualizer = mainTab === "Spectrum" && activeTab === "visualizer"
  const [sourceMode, setSourceMode] = useState<SourceMode>("live")
  const [stitchStatus, setStitchStatus] = useState("")

  // ── Auth state (REST-based) ──────────────────────────────────────────
  const [authState, setAuthState] = useState<AuthState>("connecting")
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [aesKey, setAesKey] = useState<CryptoKey | null>(null)
  const [hasPasskeys, setHasPasskeys] = useState(false)
  const [isInitialAuthCheck, setIsInitialAuthCheck] = useState(true)

  // When auth state changes, force canvas resize so FFTCanvas gets proper dimensions
  useEffect(() => {
    if (isAuthenticated) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"))
      })
    }
  }, [isAuthenticated])

  // On mount: check for stored session, fetch auth info
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      setAuthState("connecting")

      // Check for existing session first (fast path)
      const storedToken = getStoredSession()
      if (storedToken) {
        try {
          // Try to validate session immediately (no backend wait)
          const result = await validateSession(storedToken)
          if (!cancelled && result.valid) {
            setSessionToken(storedToken)
            // Derive AES key for decryption (uses default key for restored sessions)
            const key = await deriveAesKey("n-apt-dev-key")
            setAesKey(key)
            // Set authenticated state first, then auth state to prevent flashing
            setIsAuthenticated(true)
            setAuthState("ready") // Set to ready instead of success to prevent prompt flash
            setIsInitialAuthCheck(false)
            return
          }
        } catch (error) {
          // Session invalid, clear it and continue to auth info fetch
          console.warn("Session validation failed:", error)
          clearSession()
        }
      }

      // No valid session - fetch auth info (are passkeys registered?)
      // Use a shorter timeout for backend check
      const backendTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Backend timeout")), 3000)
      )

      try {
        const info = await Promise.race([fetchAuthInfo(), backendTimeout]) as any
        if (!cancelled) {
          setHasPasskeys(info.has_passkeys)
          setAuthState("ready")
          setIsInitialAuthCheck(false)
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Backend unavailable, showing auth prompt:", error)
          setAuthState("ready")
          setIsInitialAuthCheck(false)
        }
      }
    }

    init()
    return () => { cancelled = true }
  }, [])

  // Ref for whole-range SVG snapshot (current waveform per window)
  const waveformRef = useRef<Float32Array | number[] | null>(null)
  const getCurrentWaveform = useCallback(() => waveformRef.current ?? null, [])

  // Build WS URL with session token
  const wsUrl = sessionToken ? buildWsUrl(sessionToken) : ""

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
  } = useWebSocket(wsUrl, aesKey, isAuthenticated)

  // Update waveform ref when data changes
  waveformRef.current = data?.waveform ?? null

  useEffect(() => {
    setSpectrumFrames(wsSpectrumFrames)
  }, [wsSpectrumFrames])

  // Auth handlers
  const handlePasswordAuth = useCallback(async (password: string) => {
    setAuthState("authenticating")
    setAuthError(null)
    try {
      const result = await authenticateWithPassword(password)
      setSessionToken(result.token)
      // Derive AES key from the password for decryption
      const key = await deriveAesKey(password)
      setAesKey(key)
      setIsAuthenticated(true)
      setAuthState("ready") // Set to ready instead of success to prevent prompt flash
      setIsInitialAuthCheck(false)
    } catch (e: any) {
      setAuthState("failed")
      setAuthError(e.message || "Authentication failed")
    }
  }, [])

  const handlePasskeyAuth = useCallback(async () => {
    setAuthState("authenticating")
    setAuthError(null)
    try {
      const result = await authenticateWithPasskey()
      setSessionToken(result.token)
      // For passkey auth, derive AES key from the default passkey
      // (server uses the same key for all sessions)
      const key = await deriveAesKey("n-apt-dev-key")
      setAesKey(key)
      setIsAuthenticated(true)
      setAuthState("ready") // Set to ready instead of success to prevent prompt flash
      setIsInitialAuthCheck(false)
    } catch (e: any) {
      setAuthState("failed")
      setAuthError(e.message || "Passkey authentication failed")
    }
  }, [])

  const handleRegisterPasskey = useCallback(async () => {
    try {
      setAuthState("authenticating")
      await registerPasskey()
      // Refresh auth info to get updated hasPasskeys
      const info = await fetchAuthInfo()
      setHasPasskeys(info.has_passkeys)
      setAuthState("ready")
    } catch (e: any) {
      setAuthState("failed")
      setAuthError(e.message || "Passkey registration failed")
    }
  }, [setAuthState, setAuthError])

  const [visualizerPaused, setVisualizerPaused] = useState(false)

  // Training capture state
  const [isTrainingCapturing, setIsTrainingCapturing] = useState(false)
  const [trainingCaptureLabel, setTrainingCaptureLabel] = useState<"target" | "noise" | null>(null)
  const [trainingCapturedSamples, setTrainingCapturedSamples] = useState(0)

  const handleTrainingCaptureStart = useCallback(
    (label: "target" | "noise") => {
      setIsTrainingCapturing(true)
      setTrainingCaptureLabel(label)
      sendTrainingCommand("start", label, activeSignalArea)
    },
    [sendTrainingCommand, activeSignalArea],
  )

  const handleTrainingCaptureStop = useCallback(() => {
    setIsTrainingCapturing(false)
    setTrainingCaptureLabel(null)
    setTrainingCapturedSamples((prev) => prev + 1)
    sendTrainingCommand("stop", trainingCaptureLabel ?? "target", activeSignalArea)
  }, [sendTrainingCommand, trainingCaptureLabel, activeSignalArea])

  const [stitchTrigger, setStitchTrigger] = useState<number>(0)
  const [stitchSourceSettings, setStitchSourceSettings] = useState<{ gain: number; ppm: number }>({ gain: 0, ppm: 0 })
  const [isStitchPaused, setIsStitchPaused] = useState(true)

  const handleStitch = useCallback(() => {
    setIsStitchPaused(true)
    setStitchStatus("")
    setStitchTrigger((prev) => prev + 1)
  }, [])

  const handleClear = () => {
    setSelectedFiles([])
  }

  // Navigation handlers
  const handleMainTabChange = (tab: MainTab) => {
    switch (tab) {
      case "Spectrum":
        navigate("/")
        break
      case "DrawSignal":
        navigate("/draw-signal")
        break
      case "Model3D":
        navigate("/3d-model")
        break
      case "HotspotEditor":
        navigate("/hotspot-editor")
        break
    }
  }

  const handleSidebarTabChange = (tab: string) => {
    switch (tab) {
      case "visualizer":
        navigate("/")
        break
      case "analysis":
        navigate("/analysis")
        break
      default:
        navigate("/")
    }
  }

  // Trigger pause when leaving visualizer tab, resume when returning
  // Only when actually switching tabs, not on every re-render
  const prevIsVisualizerRef = useRef(isVisualizer)
  useEffect(() => {
    const prevIsVisualizer = prevIsVisualizerRef.current
    prevIsVisualizerRef.current = isVisualizer

    // Only send pause command when visualizer state actually changes
    if (prevIsVisualizer !== isVisualizer && isConnected) {
      sendPauseCommand(!isVisualizer)
      // Update local pause state to match when leaving visualizer
      if (!isVisualizer) {
        setVisualizerPaused(true)
      }
    }

    // Pause stitcher canvas when leaving visualizer tab (any main tab change)
    if (prevIsVisualizer !== isVisualizer) {
      setIsStitchPaused(!isVisualizer)
    }
  }, [isVisualizer, isConnected, mainTab, sendPauseCommand])

  const handleVisualizerPauseToggle = useCallback(() => {
    const newPausedState = !visualizerPaused
    setVisualizerPaused(newPausedState)
    if (isConnected) {
      sendPauseCommand(newPausedState)
    }
  }, [visualizerPaused, isConnected, sendPauseCommand])

  const handleSignalAreaChange = (area: string) => {
    // Only reset frequency range when switching to a different area
    if (area !== activeSignalArea) {
      setActiveSignalArea(area)
      const frame = defaultFrames.find((f: SpectrumFrame) => f.label.toLowerCase() === area.toLowerCase())
      if (frame) {
        const nextRange = { min: frame.min_mhz, max: Math.min(frame.max_mhz, frame.min_mhz + 3.2) }
        setFrequencyRange(nextRange)
        sendFrequencyRange(nextRange)
      }
    }
  }

  const handleFrequencyRangeChange = useCallback(
    (range: FrequencyRange) => {
      setFrequencyRange((prev) => {
        if (prev.min === range.min && prev.max === range.max) return prev
        return range
      })
      sendFrequencyRange(range)
    },
    [sendFrequencyRange],
  )


  const renderContent = () => {
    switch (mainTab) {
      case "Spectrum":
        return (
          <>
            <SidebarToggle
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? "◀" : "▶"} Sidebar
            </SidebarToggle>
            {isSidebarOpen && (
              <Sidebar
                isConnected={isConnected}
                isAuthenticated={isAuthenticated}
                authState={authState}
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
                onTabChange={handleSidebarTabChange}
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
              />
            )}
            <MainContent>
              {mainTab === "Spectrum" && isVisualizer && isInitialAuthCheck && (
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
              {mainTab === "Spectrum" && isVisualizer && !isAuthenticated && !isInitialAuthCheck && (
                <AuthenticationPrompt
                  authState={authState}
                  error={authError}
                  hasPasskeys={hasPasskeys}
                  onPasswordSubmit={handlePasswordAuth}
                  onPasskeyAuth={handlePasskeyAuth}
                  onRegisterPasskey={handleRegisterPasskey}
                />
              )}
              <div style={{ display: mainTab === "Spectrum" && isVisualizer && isAuthenticated && sourceMode === "live" ? 'contents' : 'none' }}>
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
                        console.warn('Invalid frequency range for FFTCanvas:', { min, max, frequencyRange });
                        return 1.6; // Default center frequency
                      }
                      return (min + max) / 2;
                    })()
                  }
                  activeSignalArea={activeSignalArea}
                  isPaused={visualizerPaused || !(mainTab === "Spectrum" && isVisualizer)}
                  isDeviceConnected={deviceState === "connected"}
                  onFrequencyRangeChange={handleFrequencyRangeChange}
                  displayTemporalResolution={displayTemporalResolution}
                  snapshotGridPreference={snapshotGridPreference}
                />
              </div>
              {isVisualizer && isAuthenticated && sourceMode === "file" && (
                <FFTStitcherCanvas
                  selectedFiles={selectedFiles}
                  stitchTrigger={stitchTrigger}
                  stitchSourceSettings={stitchSourceSettings}
                  isPaused={isStitchPaused}
                  onStitchStatus={setStitchStatus}
                />
              )}
              {!isVisualizer && <Decode />}
            </MainContent>
          </>
        )
      case "DrawSignal":
        return (
          <MainContent style={{ overflow: "auto" }}>
            <div style={{ padding: "20px", height: "100%" }}>
              <DrawMockNAPT />
            </div>
          </MainContent>
        )
      case "Model3D":
        return (
          <MainContent>
            <HumanModelViewer />
          </MainContent>
        )
      case "HotspotEditor":
        return (
          <MainContent style={{ padding: 0, margin: 0 }}>
            <HotspotEditor
              onHotspotsChange={() => {
                // You can save these to localStorage or state here
              }}
            />
          </MainContent>
        )
    }
  }

  return (
    <AppContainer>
      <AppWrapper>
        <TabContainer>
          <TabButton
            $isActive={mainTab === "Spectrum"}
            onClick={() => handleMainTabChange("Spectrum")}
          >
            Spectrum Analyzer
          </TabButton>
          <TabButton
            $isActive={mainTab === "DrawSignal"}
            onClick={() => handleMainTabChange("DrawSignal")}
          >
            Draw Signal Form
          </TabButton>
          <TabButton
            $isActive={mainTab === "Model3D"}
            onClick={() => handleMainTabChange("Model3D")}
          >
            3D Human Model
          </TabButton>
          <TabButton
            $isActive={mainTab === "HotspotEditor"}
            onClick={() => handleMainTabChange("HotspotEditor")}
          >
            Hotspot Editor
          </TabButton>
        </TabContainer>
        <ContentArea>{renderContent()}</ContentArea>
      </AppWrapper>
    </AppContainer>
  )
}

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}

export default App

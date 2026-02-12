import React, { useState, useEffect, useCallback, useRef } from "react"
import {
  BrowserRouter as Router,
  useLocation,
  useNavigate,
} from "react-router-dom"
import Sidebar from "@n-apt/components/Sidebar"
import { FFTCanvas, DrawMockNAPT } from "@n-apt/components"
import HumanModelViewer from "@n-apt/components/HumanModelViewer"
import HotspotEditor from "@n-apt/components/HotspotEditor"
import FFTStitcherCanvas from "@n-apt/components/FFTStitcherCanvas"
import { useWebSocket, FrequencyRange } from "@n-apt/hooks/useWebSocket"
import { WS_URL } from "@n-apt/consts"

// Types
type MainTab = "Spectrum" | "DrawSignal" | "Model3D" | "HotspotEditor"
type SelectedFile = { name: string; file: File }

const routeToMainTab = (path: string): MainTab => {
  switch (path) {
    case "/":
    case "/visualizer":
    case "/stitcher":
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
    case "/stitcher":
      return "stitcher"
    case "/analysis":
      return "analysis"
    case "/hotspot-editor":
      return "hotspot-editor"
    default:
      return "visualizer"
  }
}

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
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const isVisualizer = activeTab === "visualizer"
  const isStitcher = activeTab === "stitcher"

  // WebSocket hook
  const {
    isConnected,
    isDeviceConnected,
    isPaused,
    data,
    sendFrequencyRange,
    sendPauseCommand,
    sendSettings,
  } = useWebSocket(WS_URL, isVisualizer && mainTab === "Spectrum")

  const [visualizerPaused, setVisualizerPaused] = useState(false)

  const [stitchTrigger, setStitchTrigger] = useState<number>(0)
  const [stitchSourceSettings, setStitchSourceSettings] = useState<{ gain: number; ppm: number }>({ gain: 0, ppm: 0 })
  const [isStitchPaused, setIsStitchPaused] = useState(false)

  const handleStitch = useCallback(() => {
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
      case "stitcher":
        navigate("/stitcher")
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
    if (prevIsVisualizer !== isVisualizer && isConnected && mainTab === "Spectrum") {
      sendPauseCommand(!isVisualizer)
      if (isVisualizer) {
        setVisualizerPaused(false)
      }
    }
  }, [isVisualizer, isConnected, mainTab, sendPauseCommand])

  const handleVisualizerPauseToggle = useCallback(() => {
    setVisualizerPaused((p) => !p)
  }, [])

  const handleSignalAreaChange = (area: string) => {
    // Only reset frequency range when switching to a different area
    if (area !== activeSignalArea) {
      setActiveSignalArea(area)
      // Update frequency range based on selected area
      if (area === "A") {
        setFrequencyRange({ min: 0.0, max: 3.2 })
      } else if (area === "B") {
        setFrequencyRange({ min: 26.0, max: 28.2 })
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

  // Styles
  const appContainerStyle: React.CSSProperties = {
    display: "flex",
    width: "100%",
    height: "100vh",
    backgroundColor: "#0a0a0a",
  }

  const mainContentStyle: React.CSSProperties = {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  }

  const sidebarToggleStyle: React.CSSProperties = {
    position: "fixed",
    top: "20px",
    left: "20px",
    zIndex: 1000,
    backgroundColor: "#1a1a1a",
    border: "1px solid #00d4ff",
    borderRadius: "6px",
    padding: "8px 12px",
    color: "#00d4ff",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "12px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s ease",
    userSelect: "none",
  }

  const placeholderContentStyle: React.CSSProperties = {
    flex: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#444",
    fontSize: "14px",
  }

  const tabContainerStyle: React.CSSProperties = {
    display: "flex",
    backgroundColor: "#0d0d0d",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 20px",
  }

  const getTabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: "12px 24px",
    backgroundColor: isActive ? "#1a1a1a" : "transparent",
    border: "none",
    borderBottom: `2px solid ${isActive ? "#00d4ff" : "transparent"}`,
    color: isActive ? "#00d4ff" : "#666",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.2s ease",
    userSelect: "none",
  })

  const contentAreaStyle: React.CSSProperties = {
    flex: "1",
    display: "flex",
    overflow: "hidden",
  }

  const renderContent = () => {
    switch (mainTab) {
      case "Spectrum":
        return (
          <>
            <button
              style={sidebarToggleStyle}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? "◀" : "▶"} Sidebar
            </button>
            {isSidebarOpen && (
              <Sidebar
                isConnected={isConnected}
                isDeviceConnected={isDeviceConnected}
                isPaused={visualizerPaused}
                activeTab={activeTab}
                onTabChange={handleSidebarTabChange}
                activeSignalArea={activeSignalArea}
                onSignalAreaChange={handleSignalAreaChange}
                onFrequencyRangeChange={handleFrequencyRangeChange}
                onPauseToggle={handleVisualizerPauseToggle}
                onSettingsChange={sendSettings}
                selectedFiles={selectedFiles}
                onSelectedFilesChange={setSelectedFiles}
                stitchSourceSettings={stitchSourceSettings}
                onStitchSourceSettingsChange={setStitchSourceSettings}
                isStitchPaused={isStitchPaused}
                onStitchPauseToggle={() => setIsStitchPaused((p) => !p)}
                onStitch={handleStitch}
                onClear={handleClear}
              />
            )}
            <section style={mainContentStyle}>
              {isVisualizer && (
                <FFTCanvas
                  data={data}
                  frequencyRange={frequencyRange}
                  activeSignalArea={activeSignalArea}
                  isPaused={visualizerPaused}
                />
              )}
              {isStitcher && (
                <FFTStitcherCanvas
                  selectedFiles={selectedFiles}
                  stitchTrigger={stitchTrigger}
                  stitchSourceSettings={stitchSourceSettings}
                  isPaused={isStitchPaused}
                />
              )}
              {!isVisualizer && !isStitcher && (
                <div style={placeholderContentStyle}>
                  N-APT Live Deep Analysis - Coming Soon
                </div>
              )}
            </section>
          </>
        )
      case "DrawSignal":
        return (
          <section style={{ ...mainContentStyle, overflow: "auto" }}>
            <div style={{ padding: "20px", height: "100%" }}>
              <DrawMockNAPT />
            </div>
          </section>
        )
      case "Model3D":
        return (
          <section style={mainContentStyle}>
            <HumanModelViewer />
          </section>
        )
      case "HotspotEditor":
        return (
          <section style={{ ...mainContentStyle, padding: 0, margin: 0 }}>
            <HotspotEditor
              onHotspotsChange={() => {
                // You can save these to localStorage or state here
              }}
            />
          </section>
        )
    }
  }

  return (
    <div style={appContainerStyle}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
        }}
      >
        <div style={tabContainerStyle}>
          <button
            style={getTabStyle(mainTab === "Spectrum")}
            onClick={() => handleMainTabChange("Spectrum")}
          >
            Spectrum Analyzer
          </button>
          <button
            style={getTabStyle(mainTab === "DrawSignal")}
            onClick={() => handleMainTabChange("DrawSignal")}
          >
            Draw Signal Form
          </button>
          <button
            style={getTabStyle(mainTab === "Model3D")}
            onClick={() => handleMainTabChange("Model3D")}
          >
            3D Human Model
          </button>
          <button
            style={getTabStyle(mainTab === "HotspotEditor")}
            onClick={() => handleMainTabChange("HotspotEditor")}
          >
            Hotspot Editor
          </button>
        </div>
        <div style={contentAreaStyle}>{renderContent()}</div>
      </div>
    </div>
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

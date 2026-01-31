// App component migrated from JavaScript to ReScript
// Main application component with tabs for Spectrum Analyzer, Draw Signal Form, and 3D Human Model

open UseWebSocket

// React Router bindings
module ReactRouter = {
  module BrowserRouter = {
    @module("react-router-dom") @react.component
    external make: (~children: React.element) => React.element = "BrowserRouter"
  }

  module Routes = {
    @module("react-router-dom") @react.component
    external make: (~children: React.element) => React.element = "Routes"
  }

  module Route = {
    @module("react-router-dom") @react.component
    external make: (~path: string, ~element: React.element) => React.element = "Route"
  }

  module Link = {
    @module("react-router-dom") @react.component
    external make: (~to: string, ~children: React.element, ~style: ReactDOM.Style.t=?) => React.element = "Link"
  }

  @module("react-router-dom")
  external useLocation: unit => {"pathname": string} = "useLocation"

  @module("react-router-dom")
  external useNavigate: unit => (string => unit) = "useNavigate"
}

// External component bindings
module Sidebar = {
  @module("./components/Sidebar.res.mjs") @react.component
  external make: (
    ~isConnected: bool,
    ~isDeviceConnected: bool,
    ~isPaused: bool,
    ~activeTab: string,
    ~onTabChange: string => unit,
    ~activeSignalArea: string,
    ~onSignalAreaChange: string => unit,
    ~onFrequencyRangeChange: frequencyRange => unit,
    ~onPauseToggle: unit => unit,
    ~selectedFiles: array<'file>,
    ~onSelectedFilesChange: array<'file> => unit,
    ~onStitch: unit => unit,
    ~onClear: unit => unit,
  ) => React.element = "make"
}

module SpectrumVisualizer = {
  @module("./components/SpectrumVisualizer.res.mjs") @react.component
  external make: (
    ~data: option<Js.Json.t>,
    ~frequencyRange: frequencyRange,
    ~activeSignalArea: string,
    ~isPaused: bool,
  ) => React.element = "make"
}

module StitcherVisualizer = {
  @module("./components/StitcherVisualizer.res.mjs") @react.component
  external make: (
    ~selectedFiles: array<'file>,
    ~onStitch: (unit => unit) => unit,
    ~onClear: unit => unit,
  ) => React.element = "make"
}

module DrawMockNAPT = {
  @module("./components/DrawMockNAPT.res.mjs") @react.component
  external make: unit => React.element = "make"
}

module HumanModelViewer = {
  @module("./components/HumanModelViewer.res.mjs") @react.component
  external make: (~width: string=?, ~height: string=?) => React.element = "make"
}

// Main tab type
type mainTab = Spectrum | DrawSignal | Model3D

let mainTabToString = (tab: mainTab): string => {
  switch tab {
  | Spectrum => "spectrum"
  | DrawSignal => "draw-signal"
  | Model3D => "3d-model"
  }
}

let stringToMainTab = (str: string): mainTab => {
  switch str {
  | "spectrum" => Spectrum
  | "draw-signal" => DrawSignal
  | "3d-model" => Model3D
  | _ => Spectrum
  }
}

// File type for stitcher
type file = {name: string}

// Route paths
let routeToMainTab = (path: string): mainTab => {
  switch path {
  | "/" | "/visualizer" | "/stitcher" | "/analysis" => Spectrum
  | "/draw-signal" => DrawSignal
  | "/3d-model" => Model3D
  | _ => Spectrum
  }
}

let routeToActiveTab = (path: string): string => {
  switch path {
  | "/" | "/visualizer" => "visualizer"
  | "/stitcher" => "stitcher"
  | "/analysis" => "analysis"
  | _ => "visualizer"
  }
}

// Inner App component that uses router hooks
module AppContent = {
  @react.component
  let make = () => {
    let location = ReactRouter.useLocation()
    let navigate = ReactRouter.useNavigate()
    
    // Derive state from URL
    let mainTab = routeToMainTab(location["pathname"])
    let activeTab = routeToActiveTab(location["pathname"])
  let (activeSignalArea, setActiveSignalArea) = React.useState(() => "A")
  let (frequencyRange, setFrequencyRange) = React.useState(() => {min: 0.0, max: 3.2})
  let (selectedFiles, setSelectedFiles) = React.useState(() => [])

  let isVisualizer = activeTab === "visualizer"
  let isStitcher = activeTab === "stitcher"

  // WebSocket hook
  let {isConnected, isDeviceConnected, isPaused, data, sendFrequencyRange, sendPauseCommand} =
    useWebSocket("ws://localhost:8765", ~enabled=isVisualizer && mainTab === Spectrum)

  // Use ref for stitch handler to avoid stale closures
  let stitchHandlerRef = React.useRef(None)

  let handleStitch = React.useCallback0(() => {
    switch stitchHandlerRef.current {
    | Some(handler) => handler()
    | None => Js.Console.error("stitchHandlerRef.current is null! Visualizer may not be ready.")
    }
  })

  let handleClear = () => {
    setSelectedFiles(_ => [])
  }

  // Navigation handlers
  let handleMainTabChange = (tab: mainTab) => {
    switch tab {
    | Spectrum => navigate("/")
    | DrawSignal => navigate("/draw-signal")
    | Model3D => navigate("/3d-model")
    }
  }

  let handleSidebarTabChange = (tab: string) => {
    switch tab {
    | "visualizer" => navigate("/")
    | "stitcher" => navigate("/stitcher")
    | "analysis" => navigate("/analysis")
    | _ => navigate("/")
    }
  }

  // Trigger pause when leaving visualizer tab, resume when returning
  React.useEffect3(() => {
    if isConnected && mainTab === Spectrum {
      sendPauseCommand(!isVisualizer)
    }
    None
  }, (isVisualizer, isConnected, mainTab))

  let handleSignalAreaChange = (area: string) => {
    // Only reset frequency range when switching to a different area
    if area !== activeSignalArea {
      setActiveSignalArea(_ => area)
      // Update frequency range based on selected area
      if area === "A" {
        setFrequencyRange(_ => {min: 0.0, max: 3.2})
      } else if area === "B" {
        setFrequencyRange(_ => {min: 26.0, max: 28.2})
      }
    }
  }

  let handleFrequencyRangeChange = (range: frequencyRange) => {
    setFrequencyRange(_ => range)
    // Send the new frequency range to the server
    sendFrequencyRange(range)
  }

  // Styles
  let appContainerStyle = ReactDOM.Style.make(
    ~display="flex",
    ~width="100%",
    ~height="100vh",
    ~backgroundColor="#0a0a0a",
    (),
  )

  let mainContentStyle = ReactDOM.Style.make(
    ~flex="1",
    ~display="flex",
    ~flexDirection="column",
    ~overflow="hidden",
    (),
  )

  let placeholderContentStyle = ReactDOM.Style.make(
    ~flex="1",
    ~display="flex",
    ~alignItems="center",
    ~justifyContent="center",
    ~color="#444",
    ~fontSize="14px",
    (),
  )

  let tabContainerStyle = ReactDOM.Style.make(
    ~display="flex",
    ~backgroundColor="#0d0d0d",
    ~borderBottom="1px solid #1a1a1a",
    ~padding="0 20px",
    (),
  )

  let getTabStyle = (isActive: bool) =>
    ReactDOM.Style.make(
      ~padding="12px 24px",
      ~backgroundColor=isActive ? "#1a1a1a" : "transparent",
      ~border="none",
      ~borderBottom=`2px solid ${isActive ? "#00d4ff" : "transparent"}`,
      ~color=isActive ? "#00d4ff" : "#666",
      ~fontFamily="'JetBrains Mono', monospace",
      ~fontSize="13px",
      ~fontWeight="500",
      ~cursor="pointer",
      ~transition="all 0.2s ease",
      ~userSelect="none",
      (),
    )

  let contentAreaStyle = ReactDOM.Style.make(
    ~flex="1",
    ~display="flex",
    ~overflow="hidden",
    (),
  )

  let renderContent = () => {
    switch mainTab {
    | Spectrum =>
      <>
        <Sidebar
          isConnected
          isDeviceConnected
          isPaused
          activeTab
          onTabChange={handleSidebarTabChange}
          activeSignalArea
          onSignalAreaChange={handleSignalAreaChange}
          onFrequencyRangeChange={handleFrequencyRangeChange}
          onPauseToggle={() => sendPauseCommand(!isPaused)}
          selectedFiles
          onSelectedFilesChange={files => setSelectedFiles(_ => files)}
          onStitch={handleStitch}
          onClear={handleClear}
        />
        <section style={mainContentStyle}>
          {if isVisualizer {
            <SpectrumVisualizer data frequencyRange activeSignalArea isPaused />
          } else if isStitcher {
            <StitcherVisualizer
              selectedFiles
              onStitch={handler => {
                stitchHandlerRef.current = Some(handler)
              }}
              onClear={handleClear}
            />
          } else {
            <div style={placeholderContentStyle}>
              {React.string("N-APT Live Deep Analysis - Coming Soon")}
            </div>
          }}
        </section>
      </>
    | DrawSignal =>
      <section style={ReactDOM.Style.combine(mainContentStyle, ReactDOM.Style.make(~overflow="auto", ()))}>
        <div style={ReactDOM.Style.make(~padding="20px", ~height="100%", ())}>
          <DrawMockNAPT />
        </div>
      </section>
    | Model3D =>
      <section style={mainContentStyle}>
        <HumanModelViewer />
      </section>
    }
  }

  <div style={appContainerStyle}>
    <div
      style={ReactDOM.Style.make(
        ~display="flex",
        ~flexDirection="column",
        ~width="100%",
        ~height="100%",
        (),
      )}>
      <div style={tabContainerStyle}>
        <button
          style={getTabStyle(mainTab === Spectrum)}
          onClick={_ => handleMainTabChange(Spectrum)}>
          {React.string("Spectrum Analyzer")}
        </button>
        <button
          style={getTabStyle(mainTab === DrawSignal)}
          onClick={_ => handleMainTabChange(DrawSignal)}>
          {React.string("Draw Signal Form")}
        </button>
        <button
          style={getTabStyle(mainTab === Model3D)}
          onClick={_ => handleMainTabChange(Model3D)}>
          {React.string("3D Human Model")}
        </button>
      </div>
      <div style={contentAreaStyle}> {renderContent()} </div>
    </div>
  </div>
  }
}

// Main App component with BrowserRouter wrapper
@react.component
let make = () => {
  <ReactRouter.BrowserRouter>
    <AppContent />
  </ReactRouter.BrowserRouter>
}

let default = make

// Sidebar component migrated from JavaScript to ReScript
// Uses inline styles instead of styled-components

open UseWebSocket

// Component bindings for migrated ReScript components
module FrequencyRangeSlider = {
  @module("./FrequencyRangeSlider.res.mjs") @react.component
  external make: (
    ~label: string,
    ~minFreq: float,
    ~maxFreq: float,
    ~visibleMin: float,
    ~visibleMax: float,
    ~isActive: bool,
    ~onActivate: unit => unit,
    ~onRangeChange: frequencyRange => unit,
  ) => React.element = "make"
}

module InfoPopover = {
  @module("./InfoPopover.res.mjs") @react.component
  external make: (~title: string, ~content: string) => React.element = "make"
}

// File type binding
type file = {
  name: string,
}

// DOM bindings
@scope("document")
external getElementById: string => option<Dom.element> = "getElementById"

@send
external click: Dom.element => unit = "click"

// FileList binding
@scope("globalThis")
external fileList: {..} = "FileList"

// Tab type
type tab = Visualizer | Stitcher | Analysis

// Props type
type sidebarProps = {
  isConnected: bool,
  isDeviceConnected: bool,
  isPaused: bool,
  activeTab: string,
  onTabChange: string => unit,
  activeSignalArea: string,
  onSignalAreaChange: string => unit,
  onFrequencyRangeChange: frequencyRange => unit,
  onPauseToggle: unit => unit,
  selectedFiles: array<file>,
  onSelectedFilesChange: array<file> => unit,
  onStitch: unit => unit,
  onClear: unit => unit,
}

@react.component
let make = (
  ~isConnected: bool,
  ~isDeviceConnected: bool,
  ~isPaused: bool,
  ~activeTab: string,
  ~onTabChange: string => unit,
  ~activeSignalArea: string,
  ~onSignalAreaChange: string => unit,
  ~onFrequencyRangeChange: frequencyRange => unit,
  ~onPauseToggle: unit => unit,
  ~selectedFiles: array<file>,
  ~onSelectedFilesChange: array<file> => unit,
  ~onStitch: unit => unit,
  ~onClear: unit => unit,
) => {
  // FFT Settings state
  let (fftSize, setFftSize) = React.useState(() => 103432)
  let (fftWindow, setFftWindow) = React.useState(() => "Rectangular")
  let (fftFrameRate, setFftFrameRate) = React.useState(() => 60)

  // Use refs to track last notified values to prevent excessive updates
  let lastNotifiedRangeRef = React.useRef({min: 0.0, max: 3.2})

  let handleAreaARangeChange = React.useCallback1((range: frequencyRange) => {
    if activeSignalArea === "A" {
      // Only notify if changed significantly (0.01 MHz = 10 kHz threshold)
      let minDiff = Js.Math.abs_float(range.min -. lastNotifiedRangeRef.current.min)
      let maxDiff = Js.Math.abs_float(range.max -. lastNotifiedRangeRef.current.max)
      if minDiff > 0.01 || maxDiff > 0.01 {
        lastNotifiedRangeRef.current = range
        onFrequencyRangeChange(range)
      }
    }
  }, [activeSignalArea])

  let handleAreaBRangeChange = React.useCallback1((range: frequencyRange) => {
    if activeSignalArea === "B" {
      let minDiff = Js.Math.abs_float(range.min -. lastNotifiedRangeRef.current.min)
      let maxDiff = Js.Math.abs_float(range.max -. lastNotifiedRangeRef.current.max)
      if minDiff > 0.01 || maxDiff > 0.01 {
        lastNotifiedRangeRef.current = range
        onFrequencyRangeChange(range)
      }
    }
  }, [activeSignalArea])

  let handleFileInputChange = (event: ReactEvent.Form.t) => {
    let target = ReactEvent.Form.target(event)
    let files = target["files"]
    if Js.Nullable.isNullable(files) {
      ()
    } else {
      let fileArray = Js.Array.from(files)
      onSelectedFilesChange(fileArray)
    }
  }

  let handleBrowseClick = () => {
    switch getElementById("fileInput") {
    | Some(el) => click(el)
    | None => ()
    }
  }

  let handleRemoveFile = (index: int) => {
    let filtered = Js.Array.filteri((_, i) => i !== index, selectedFiles)
    onSelectedFilesChange(filtered)
  }

  let handleStitch = () => {
    Js.Console.log("Sidebar stitch button clicked")
    onStitch()
  }

  let handleClear = () => {
    Js.Console.log("Sidebar clear button clicked")
    onClear()
  }

  // Style objects
  let sidebarContainerStyle = ReactDOM.Style.make(
    ~width="360px",
    ~minWidth="360px",
    ~height="100vh",
    ~backgroundColor="#0d0d0d",
    ~borderRight="1px solid #1a1a1a",
    ~display="flex",
    ~flexDirection="column",
    ~padding="24px",
    ~overflowY="auto",
    ~overflowX="visible",
    ~position="relative",
    (),
  )

  let connectionStatusContainerStyle = ReactDOM.Style.make(
    ~display="flex",
    ~alignItems="center",
    ~gridColumnGap="8px",
    ~gridRowGap="8px",
    ~marginBottom="24px",
    (),
  )

  let connectionStatusStyle = ReactDOM.Style.make(
    ~display="flex",
    ~alignItems="center",
    ~gridColumnGap="8px",
    ~gridRowGap="8px",
    ~flex="0 0 70%",
    ~padding="12px 16px",
    ~backgroundColor="#141414",
    ~borderRadius="8px",
    ~border="1px solid #1f1f1f",
    (),
  )

  let getStatusDotStyle = (connected: bool) =>
    ReactDOM.Style.make(
      ~width="8px",
      ~height="8px",
      ~borderRadius="50%",
      ~backgroundColor=connected ? "#00d4ff" : "#ff4444",
      ~boxShadow=connected ? "0 0 8px #00d4ff" : "0 0 8px #ff4444",
      ~flexShrink="0",
      (),
    )

  let statusTextStyle = ReactDOM.Style.make(
    ~fontSize="12px",
    ~color="#888",
    ~fontWeight="500",
    (),
  )

  let getPauseButtonStyle = (paused: bool) =>
    ReactDOM.Style.make(
      ~flex="0 0 25%",
      ~padding="12px 8px",
      ~backgroundColor=paused ? "#2a2a2a" : "#1a1a1a",
      ~border=`1px solid ${paused ? "#00d4ff" : "#2a2a2a"}`,
      ~borderRadius="8px",
      ~color=paused ? "#00d4ff" : "#ccc",
      ~fontFamily="'JetBrains Mono', monospace",
      ~fontSize="12px",
      ~fontWeight="500",
      ~cursor="pointer",
      ~textAlign="center",
      ~transition="all 0.2s ease",
      ~userSelect="none",
      (),
    )

  let tabContainerStyle = ReactDOM.Style.make(
    ~display="flex",
    ~flexDirection="column",
    ~gridRowGap="8px",
    ~gridColumnGap="8px",
    ~marginBottom="24px",
    (),
  )

  let getTabStyle = (isActive: bool) =>
    ReactDOM.Style.make(
      ~padding="12px 16px",
      ~backgroundColor=isActive ? "#1a1a1a" : "transparent",
      ~border=`1px solid ${isActive ? "#2a2a2a" : "transparent"}`,
      ~borderRadius="8px",
      ~color=isActive ? "#00d4ff" : "#666",
      ~fontFamily="'JetBrains Mono', monospace",
      ~fontSize="13px",
      ~fontWeight="500",
      ~cursor="pointer",
      ~textAlign="left",
      ~transition="all 0.2s ease",
      ~userSelect="none",
      (),
    )

  let sectionStyle = ReactDOM.Style.make(~marginBottom="24px", ())

  let sectionTitleStyle = ReactDOM.Style.make(
    ~fontSize="11px",
    ~color="#555",
    ~textTransform="uppercase",
    ~letterSpacing="1px",
    ~marginBottom="12px",
    ~display="flex",
    ~alignItems="center",
    ~gridColumnGap="8px",
    ~gridRowGap="8px",
    (),
  )

  let settingRowStyle = ReactDOM.Style.make(
    ~display="flex",
    ~alignItems="center",
    ~justifyContent="space-between",
    ~padding="10px 12px",
    ~backgroundColor="#141414",
    ~borderRadius="6px",
    ~marginBottom="8px",
    ~border="1px solid #1a1a1a",
    ~userSelect="none",
    (),
  )

  let settingLabelContainerStyle = ReactDOM.Style.make(
    ~display="flex",
    ~alignItems="center",
    (),
  )

  let settingLabelStyle = ReactDOM.Style.make(~fontSize="12px", ~color="#777", ())

  let settingValueStyle = ReactDOM.Style.make(
    ~fontSize="12px",
    ~color="#ccc",
    ~fontWeight="500",
    (),
  )

  let settingSelectStyle = ReactDOM.Style.make(
    ~backgroundColor="transparent",
    ~border="1px solid transparent",
    ~borderRadius="4px",
    ~color="#ccc",
    ~fontFamily="'JetBrains Mono', monospace",
    ~fontSize="12px",
    ~fontWeight="500",
    ~padding="2px 6px",
    ~minWidth="80px",
    ~cursor="pointer",
    (),
  )

  let settingInputStyle = ReactDOM.Style.make(
    ~backgroundColor="transparent",
    ~border="1px solid transparent",
    ~borderRadius="4px",
    ~color="#ccc",
    ~fontFamily="'JetBrains Mono', monospace",
    ~fontSize="12px",
    ~fontWeight="500",
    ~padding="2px 6px",
    ~width="50px",
    ~textAlign="center",
    (),
  )

  let flexGapStyle = ReactDOM.Style.make(~display="flex", ~alignItems="center", ~gridColumnGap="4px", ~gridRowGap="4px", ())

  let fpsTextStyle = ReactDOM.Style.make(~fontSize="12px", ~color="#ccc", ~fontWeight="500", ())

  let browseButtonStyle = ReactDOM.Style.make(
    ~flex="none",
    ~fontSize="11px",
    ~padding="8px 12px",
    ~backgroundColor="#1a1a1a",
    ~border="1px solid #2a2a2a",
    ~borderRadius="8px",
    ~color="#ccc",
    ~fontFamily="'JetBrains Mono', monospace",
    ~fontWeight="500",
    ~cursor="pointer",
    (),
  )

  let fileNameStyle = ReactDOM.Style.make(
    ~fontSize="11px",
    ~maxWidth="240px",
    ~overflow="hidden",
    ~textOverflow="ellipsis",
    ~whiteSpace="nowrap",
    (),
  )

  let removeButtonStyle = ReactDOM.Style.make(
    ~flex="none",
    ~fontSize="10px",
    ~padding="4px 8px",
    ~background="transparent",
    ~border="1px solid #2a2a2a",
    ~borderRadius="8px",
    ~color="#ccc",
    ~fontFamily="'JetBrains Mono', monospace",
    ~fontWeight="500",
    ~cursor="pointer",
    (),
  )

  let buttonRowStyle = ReactDOM.Style.make(~display="flex", ~gridColumnGap="8px", ~gridRowGap="8px", ())

  let flexButtonStyle = ReactDOM.Style.make(
    ~flex="1",
    ~padding="12px 8px",
    ~backgroundColor="#1a1a1a",
    ~border="1px solid #2a2a2a",
    ~borderRadius="8px",
    ~color="#ccc",
    ~fontFamily="'JetBrains Mono', monospace",
    ~fontSize="12px",
    ~fontWeight="500",
    ~cursor="pointer",
    ~textAlign="center",
    (),
  )

  let transparentButtonStyle = ReactDOM.Style.make(
    ~flex="1",
    ~padding="12px 8px",
    ~background="transparent",
    ~border="1px solid #2a2a2a",
    ~borderRadius="8px",
    ~color="#ccc",
    ~fontFamily="'JetBrains Mono', monospace",
    ~fontSize="12px",
    ~fontWeight="500",
    ~cursor="pointer",
    ~textAlign="center",
    (),
  )

  // Helper to get connection status text
  let getStatusText = () => {
    if !isConnected {
      "Disconnected"
    } else if isDeviceConnected {
      "Connected to server and device"
    } else {
      "Connected to server but device not connected"
    }
  }

  <aside style={sidebarContainerStyle}>
    <div style={tabContainerStyle}>
      <button
        style={getTabStyle(activeTab === "visualizer")}
        onClick={_ => onTabChange("visualizer")}>
        {"Live N-APT visualizer"->React.string}
      </button>
      <button
        style={getTabStyle(activeTab === "stitcher")}
        onClick={_ => onTabChange("stitcher")}>
        {"N-APT stitcher & I/Q replay"->React.string}
      </button>
      <button
        style={getTabStyle(activeTab === "analysis")}
        onClick={_ => onTabChange("analysis")}>
        {"N-APT live deep analysis"->React.string}
      </button>
    </div>

    {switch activeTab {
    | "visualizer" =>
      <>
        <div style={connectionStatusContainerStyle}>
          <div style={connectionStatusStyle}>
            <div style={getStatusDotStyle(isConnected && isDeviceConnected)} />
            <span style={statusTextStyle}> {getStatusText()->React.string} </span>
          </div>
          {isConnected
            ? <button style={getPauseButtonStyle(isPaused)} onClick={_ => onPauseToggle()}>
                {(isPaused ? "Resume" : "Pause")->React.string}
              </button>
            : React.null}
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}> {"Source"->React.string} </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"RTL-SDR v4"->React.string} </span>
              <InfoPopover
                title="RTL-SDR v4"
                content="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
              />
            </div>
            <span style={settingValueStyle}>
              {(isConnected && isDeviceConnected ? "Active" : "Unavailable")->React.string}
            </span>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}> {"Signal areas of interest"->React.string} </div>
          <FrequencyRangeSlider
            label="A"
            minFreq={0.0}
            maxFreq={4.75}
            visibleMin={0.0}
            visibleMax={3.2}
            isActive={activeSignalArea === "A"}
            onActivate={() => onSignalAreaChange("A")}
            onRangeChange={handleAreaARangeChange}
          />
          <FrequencyRangeSlider
            label="B"
            minFreq={24.15}
            maxFreq={30.0}
            visibleMin={26.0}
            visibleMax={28.2}
            isActive={activeSignalArea === "B"}
            onActivate={() => onSignalAreaChange("B")}
            onRangeChange={handleAreaBRangeChange}
          />
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}> {"Signal kind"->React.string} </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"N-APT"->React.string} </span>
              <InfoPopover
                title="N-APT"
                content="NOAA Automatic Picture Transmission - Weather satellite imagery transmitted in analog format."
              />
            </div>
            <span style={settingValueStyle}> {"Active"->React.string} </span>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}> {"Signal display"->React.string} </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"FFT Size"->React.string} </span>
              <InfoPopover
                title="FFT Size"
                content="Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."
              />
            </div>
            <select
              style={settingSelectStyle}
              value={fftSize->Belt.Int.toString}
              onChange={e => {
                let target = ReactEvent.Form.target(e)
                let value = target["value"]->Belt.Int.fromString->Belt.Option.getWithDefault(103432)
                setFftSize(_ => value)
              }}>
              <option value="8192"> {"8192"->React.string} </option>
              <option value="16384"> {"16384"->React.string} </option>
              <option value="32768"> {"32768"->React.string} </option>
              <option value="65536"> {"65536"->React.string} </option>
              <option value="103432"> {"103432"->React.string} </option>
              <option value="131072"> {"131072"->React.string} </option>
              <option value="262144"> {"262144"->React.string} </option>
            </select>
          </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"FFT Window"->React.string} </span>
              <InfoPopover
                title="FFT Window"
                content="Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium."
              />
            </div>
            <select
              style={settingSelectStyle}
              value={fftWindow}
              onChange={e => {
                let target = ReactEvent.Form.target(e)
                setFftWindow(_ => target["value"])
              }}>
              <option value="Rectangular"> {"Rectangular"->React.string} </option>
              <option value="Blackman"> {"Blackman"->React.string} </option>
              <option value="Nuttall"> {"Nuttall"->React.string} </option>
            </select>
          </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"FFT Frame Rate"->React.string} </span>
              <InfoPopover
                title="FFT Frame Rate"
                content="Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit."
              />
            </div>
            <div style={flexGapStyle}>
              <input
                type_="number"
                style={settingInputStyle}
                value={fftFrameRate->Belt.Int.toString}
                min="1"
                max="120"
                onChange={e => {
                  let target = ReactEvent.Form.target(e)
                  let value = target["value"]->Belt.Int.fromString->Belt.Option.getWithDefault(1)
                  let clamped = Js.Math.max_int(1, Js.Math.min_int(120, value))
                  setFftFrameRate(_ => clamped)
                }}
              />
              <span style={fpsTextStyle}> {"fps"->React.string} </span>
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}> {"Source Settings"->React.string} </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"PPM"->React.string} </span>
              <InfoPopover
                title="PPM Correction"
                content="Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit."
              />
            </div>
            <span style={settingValueStyle}> {"1"->React.string} </span>
          </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"Gain"->React.string} </span>
              <InfoPopover
                title="Gain Setting"
                content="Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur."
              />
            </div>
            <span style={settingValueStyle}> {"+49.06dB"->React.string} </span>
          </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"Bandwidth"->React.string} </span>
              <InfoPopover
                title="Bandwidth"
                content="At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum."
              />
            </div>
            <span style={settingValueStyle}> {"3.2MHz (max)"->React.string} </span>
          </div>
        </div>
      </>
    | "stitcher" =>
      <>
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}> {"File selection"->React.string} </div>
          <div style={settingRowStyle}>
            <div style={settingLabelContainerStyle}>
              <span style={settingLabelStyle}> {"Choose files..."->React.string} </span>
            </div>
            <div style={flexGapStyle}>
              <input
                type_="file"
                accept=".c64"
                multiple={true}
                style={ReactDOM.Style.make(~display="none", ())}
                id="fileInput"
                onChange={handleFileInputChange}
              />
              <button style={browseButtonStyle} onClick={_ => handleBrowseClick()}>
                {"Browse"->React.string}
              </button>
            </div>
          </div>
        </div>

        {if Js.Array.length(selectedFiles) > 0 {
          <>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>
                {(`Selected files (${Js.Array.length(selectedFiles)->Belt.Int.toString})`)->React.string}
              </div>
              {selectedFiles
              ->Belt.Array.mapWithIndex((index, file) => {
                <div key={index->Belt.Int.toString} style={settingRowStyle}>
                  <div style={settingLabelContainerStyle}>
                    <span style={fileNameStyle}> {file.name->React.string} </span>
                  </div>
                  <button
                    style={removeButtonStyle} onClick={_ => handleRemoveFile(index)}>
                    {"Remove"->React.string}
                  </button>
                </div>
              })
              ->React.array}
            </div>

            <div style={sectionStyle}>
              <div style={buttonRowStyle}>
                <button style={flexButtonStyle} onClick={_ => handleStitch()}>
                  {"Stitch spectrum"->React.string}
                </button>
                <button style={transparentButtonStyle} onClick={_ => handleClear()}>
                  {"Clear"->React.string}
                </button>
              </div>
            </div>
          </>
        } else {
          React.null
        }}
      </>
    | _ => React.null
    }}
  </aside>
}

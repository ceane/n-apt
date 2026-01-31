// FrequencyRangeSlider component migrated from JavaScript to ReScript
// A custom slider for selecting frequency ranges with mouse drag and keyboard navigation

open UseWebSocket

// Props type for the component
type sliderProps = {
  minFreq?: float,
  maxFreq?: float,
  visibleMin?: float,
  visibleMax?: float,
  label?: string,
  stepSize?: float,
  isActive?: bool,
  onActivate?: unit => unit,
  onRangeChange?: frequencyRange => unit,
}

// DOM bindings
@send
external getBoundingClientRect: Dom.element => {"left": float, "width": float} = "getBoundingClientRect"

@send
external closest: (Dom.element, string) => option<Dom.element> = "closest"

@get
external eventTarget: JsxEventU.Mouse.t => Dom.element = "target"

// Window event bindings
@scope("window")
external addEventListener: (string, 'a => unit) => unit = "addEventListener"

@scope("window")
external removeEventListener: (string, 'a => unit) => unit = "removeEventListener"

// Helper function to format frequency
let formatFreq = (freq: float): string => {
  if freq < 1.0 {
    Js.Float.toFixedWithPrecision(freq *. 1000.0, ~digits=0) ++ "kHz"
  } else {
    Js.Float.toFixedWithPrecision(freq, ~digits=1) ++ "MHz"
  }
}

@react.component
let make = (
  ~minFreq: float=0.0,
  ~maxFreq: float=4.75,
  ~visibleMin: float=0.0,
  ~visibleMax: float=3.2,
  ~label: string="A",
  ~stepSize: float=0.033,
  ~isActive: bool=false,
  ~onActivate: unit => unit=() => (),
  ~onRangeChange: option<frequencyRange => unit>=?,
) => {
  // Calculate window width (constant based on visible range)
  let totalRange = maxFreq -. minFreq
  let windowWidth = (visibleMax -. visibleMin) /. totalRange

  // Initialize windowStart from props
  let (windowStart, setWindowStart) = React.useState(() => (visibleMin -. minFreq) /. totalRange)
  let (isDragging, setIsDragging) = React.useState(() => false)

  // Refs for drag handling
  let isDraggingRef = React.useRef(false)
  let trackRef = React.useRef(None)
  let containerRef = React.useRef(None)
  let dragStartXRef = React.useRef(0.0)
  let dragStartWindowRef = React.useRef(0.0)

  // Calculate current min/max frequencies
  let currentMin = minFreq +. windowStart *. totalRange
  let currentMax = minFreq +. (windowStart +. windowWidth) *. totalRange

  // Notify parent of range changes
  let notifyParent = React.useCallback4(() => {
    switch (isActive, onRangeChange) {
    | (true, Some(callback)) =>
      callback({min: currentMin, max: currentMax})
    | _ => ()
    }
  }, (isActive, onRangeChange, currentMin, currentMax))

  // Notify parent during dragging for real-time updates
  React.useEffect6(() => {
    if isActive && isDragging {
      switch onRangeChange {
      | Some(callback) => callback({min: currentMin, max: currentMax})
      | None => ()
      }
    }
    None
  }, (windowStart, isActive, onRangeChange, currentMin, currentMax, isDragging))

  // Notify parent when windowStart changes via keyboard (not dragging)
  React.useEffect6(() => {
    if isActive && !isDragging {
      switch onRangeChange {
      | Some(callback) => callback({min: currentMin, max: currentMax})
      | None => ()
      }
    }
    None
  }, (windowStart, isActive, onRangeChange, currentMin, currentMax, isDragging))

  // Move window by step (for keyboard navigation)
  let moveWindow = React.useCallback3((direction: [#up | #down]) => {
    let stepPercent = stepSize /. totalRange
    setWindowStart(prev => {
      let delta = switch direction {
      | #up => stepPercent
      | #down => -.stepPercent
      }
      let newStart = prev +. delta
      Js.Math.max_float(0.0, Js.Math.min_float(1.0 -. windowWidth, newStart))
    })
  }, (stepSize, totalRange, windowWidth))

  // Keyboard navigation effect
  React.useEffect2(() => {
    let handleKeyDown = (e: {"key": string, "preventDefault": unit => unit}) => {
      if !isActive {
        ()
      } else {
        switch e["key"] {
        | "ArrowUp" =>
          e["preventDefault"](.)
          moveWindow(#up)
        | "ArrowDown" =>
          e["preventDefault"](.)
          moveWindow(#down)
        | _ => ()
        }
      }
    }

    addEventListener("keydown", handleKeyDown)
    Some(() => removeEventListener("keydown", handleKeyDown))
  }, (isActive, moveWindow))

  // Mouse drag handling effect
  React.useEffect3(() => {
    let handleMouseMove = (e: {"clientX": float}) => {
      if !isDraggingRef.current {
        ()
      } else {
        switch trackRef.current {
        | Some(track) =>
          let rect = getBoundingClientRect(track)
          let deltaX = e["clientX"] -. dragStartXRef.current
          let deltaPercent = deltaX /. rect["width"]
          let newStart = dragStartWindowRef.current +. deltaPercent
          let clampedStart = Js.Math.max_float(0.0, Js.Math.min_float(1.0 -. windowWidth, newStart))
          setWindowStart(_ => clampedStart)
        | None => ()
        }
      }
    }

    let handleMouseUp = (_e: 'a) => {
      if isDraggingRef.current {
        isDraggingRef.current = false
        setIsDragging(_ => false)
        notifyParent()
      }
    }

    addEventListener("mousemove", handleMouseMove)
    addEventListener("mouseup", handleMouseUp)

    Some(() => {
      removeEventListener("mousemove", handleMouseMove)
      removeEventListener("mouseup", handleMouseUp)
    })
  }, (windowWidth, notifyParent, setWindowStart))

  // Mouse down handler for the window
  let handleMouseDown = React.useCallback1((e: JsxEventU.Mouse.t) => {
    JsxEventU.Mouse.stopPropagation(e)
    isDraggingRef.current = true
    setIsDragging(_ => true)
    dragStartXRef.current = JsxEventU.Mouse.clientX(e)->Belt.Int.toFloat
    dragStartWindowRef.current = windowStart
  }, [windowStart])

  // Container click handler
  let handleContainerClick = React.useCallback1((e: JsxEventU.Mouse.t) => {
    // Check if click was on container or range-track
    let target = eventTarget(e)
    let shouldActivate = switch containerRef.current {
    | Some(container) if container === target => true
    | _ =>
      switch closest(target, ".range-track") {
      | Some(_) => true
      | None => false
      }
    }
    if shouldActivate {
      onActivate()
    }
  }, [onActivate])

  // Styles
  let sliderWrapperStyle = ReactDOM.Style.make(
    ~display="flex",
    ~alignItems="center",
    ~marginBottom="16px",
    ~userSelect="none",
    (),
  )

  let labelContainerStyle = ReactDOM.Style.make(
    ~display="flex",
    ~alignItems="center",
    ~justifyContent="center",
    ~width="32px",
    ~flexShrink="0",
    (),
  )

  let labelStyle = ReactDOM.Style.make(
    ~fontSize="24px",
    ~fontWeight="700",
    ~color=isActive ? "#00d4ff" : "#666",
    ~transition="color 0.2s ease",
    (),
  )

  let sliderContainerStyle = ReactDOM.Style.make(
    ~flex="1",
    ~userSelect="none",
    ~outline="none",
    ~padding="8px",
    ~borderRadius="6px",
    ~border=`1px solid ${isActive ? "#00d4ff" : "transparent"}`,
    ~backgroundColor=isActive ? "rgba(0, 212, 255, 0.05)" : "transparent",
    ~cursor="pointer",
    ~transition="border-color 0.2s ease, background-color 0.2s ease",
    (),
  )

  let rangeTrackStyle = ReactDOM.Style.make(
    ~position="relative",
    ~height="32px",
    ~backgroundColor="#0f0f0f",
    ~border="1px solid #1a1a1a",
    ~borderRadius="4px",
    ~overflow="hidden",
    ~userSelect="none",
    (),
  )

  let rangeLabelsStyle = ReactDOM.Style.make(
    ~position="absolute",
    ~top="0",
    ~left="0",
    ~right="0",
    ~bottom="0",
    ~display="flex",
    ~justifyContent="space-between",
    ~alignItems="center",
    ~padding="0 12px",
    ~fontSize="9px",
    ~color="#444",
    ~pointerEvents="none",
    ~userSelect="none",
    (),
  )

  let visibleWindowStyle = ReactDOM.Style.make(
    ~position="absolute",
    ~top="2px",
    ~bottom="2px",
    ~left=`${Js.Float.toString(windowStart *. 100.0)}%`,
    ~width=`${Js.Float.toString(windowWidth *. 100.0)}%`,
    ~backgroundColor=isActive ? "rgba(0, 212, 255, 0.15)" : "rgba(128, 128, 128, 0.15)",
    ~border=`1px solid ${isActive ? "#00d4ff" : "#808080"}`,
    ~borderRadius="2px",
    ~cursor="grab",
    ~display="flex",
    ~alignItems="center",
    ~justifyContent="center",
    ~userSelect="none",
    ~padding="0 6px",
    ~minWidth="80px",
    ~boxSizing="border-box",
    (),
  )

  let windowLabelStyle = ReactDOM.Style.make(
    ~fontSize="9px",
    ~color=isActive ? "#00d4ff" : "#808080",
    ~whiteSpace="nowrap",
    ~pointerEvents="none",
    ~userSelect="none",
    (),
  )

  let rangeInfoStyle = ReactDOM.Style.make(
    ~display="flex",
    ~justifyContent="space-between",
    ~alignItems="center",
    ~marginTop="8px",
    ~padding="0 4px",
    ~fontSize="11px",
    ~userSelect="none",
    (),
  )

  let rangeLabelStyle = ReactDOM.Style.make(
    ~color=isActive ? "#00d4ff" : "#666",
    ~fontWeight=isActive ? "500" : "400",
    ~userSelect="none",
    (),
  )

  let rangeValueStyle = ReactDOM.Style.make(
    ~color=isActive ? "#00d4ff" : "#808080",
    ~fontWeight="500",
    ~userSelect="none",
    (),
  )

  <div style={sliderWrapperStyle}>
    <div style={labelContainerStyle}>
      <div style={labelStyle}> {React.string(label)} </div>
    </div>
    <div
      ref={ReactDOM.Ref.callbackDomRef(el => containerRef.current = Js.Nullable.toOption(el))}
      style={sliderContainerStyle}
      onClick={handleContainerClick}
      tabIndex={0}
    >
      <div
        ref={ReactDOM.Ref.callbackDomRef(el => trackRef.current = Js.Nullable.toOption(el))}
        className="range-track"
        style={rangeTrackStyle}
      >
        <div style={rangeLabelsStyle}>
          <span> {React.string(formatFreq(minFreq))} </span>
          <span> {React.string(formatFreq(maxFreq))} </span>
        </div>
        <div style={visibleWindowStyle} onMouseDown={handleMouseDown}>
          <div style={windowLabelStyle}>
            {React.string(`${formatFreq(currentMin)} - ${formatFreq(currentMax)}`)}
          </div>
        </div>
      </div>
      <div style={rangeInfoStyle}>
        <div style={rangeLabelStyle}>
          {React.string(`${formatFreq(minFreq)} to ${formatFreq(maxFreq)}`)}
        </div>
        <div style={rangeValueStyle}>
          {React.string(`${formatFreq(currentMin)} to ${formatFreq(currentMax)}`)}
        </div>
      </div>
    </div>
  </div>
}

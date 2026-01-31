// Spectrum Visualizer Component - ReScript implementation
// Canvas-based spectrum and waterfall visualizer with SDR++ style

open UseWebSocket

// DOM element bindings
@get external clientWidth: Dom.element => int = "clientWidth"
@get external clientHeight: Dom.element => int = "clientHeight"
@scope("window") external addEventListener: (string, unit => unit) => unit = "addEventListener"
@scope("window") external removeEventListener: (string, unit => unit) => unit = "removeEventListener"

// Canvas 2D context bindings - using Dom.element directly for refs
@get external canvasWidth: Dom.element => int = "width"
@get external canvasHeight: Dom.element => int = "height"
@set external setCanvasWidth: (Dom.element, int) => unit = "width"
@set external setCanvasHeight: (Dom.element, int) => unit = "height"
@send external getContext: (Dom.element, string) => Js.Nullable.t<'ctx> = "getContext"
@get external parentElement: Dom.element => Js.Nullable.t<Dom.element> = "parentElement"

module CanvasOps = {
  let width = canvasWidth
  let height = canvasHeight
  let setWidth = setCanvasWidth
  let setHeight = setCanvasHeight
}

// ImageData type for canvas
type imageData = {
  data: Js.Typed_array.Uint8ClampedArray.t,
  width: int,
  height: int,
}

module Canvas2D = {
  type t
  @set external fillStyle: (t, string) => unit = "fillStyle"
  @set external strokeStyle: (t, string) => unit = "strokeStyle"
  @set external lineWidth: (t, float) => unit = "lineWidth"
  @set external lineJoin: (t, string) => unit = "lineJoin"
  @set external lineCap: (t, string) => unit = "lineCap"
  @set external font: (t, string) => unit = "font"
  @set external textAlign: (t, string) => unit = "textAlign"
  @send external fillRect: (t, float, float, float, float) => unit = "fillRect"
  @send external beginPath: t => unit = "beginPath"
  @send external moveTo: (t, float, float) => unit = "moveTo"
  @send external lineTo: (t, float, float) => unit = "lineTo"
  @send external closePath: t => unit = "closePath"
  @send external fill: t => unit = "fill"
  @send external stroke: t => unit = "stroke"
  @send external fillText: (t, string, float, float) => unit = "fillText"
  @send external createImageData: (t, int, int) => imageData = "createImageData"
  @send external putImageData: (t, imageData, int, int) => unit = "putImageData"
}

// Performance bindings
@scope("performance") external now: unit => float = "now"
@val external devicePixelRatio: float = "window.devicePixelRatio"
@scope("globalThis") external cancelAnimationFrame: int => unit = "cancelAnimationFrame"

// Props type for the component
type spectrumVisualizerProps = {
  data: option<Js.Json.t>,
  frequencyRange: frequencyRange,
  activeSignalArea: string,
  isPaused: bool,
}

// Data structure from WebSocket
module SpectrumData = {
  type t = {
    waveform: option<array<float>>,
    waterfall: option<array<int>>,
  }

  let fromJson = (json: Js.Json.t): t => {
    switch Js.Json.decodeObject(json) {
    | Some(obj) =>
      let waveform = switch Js.Dict.get(obj, "waveform") {
      | Some(v) =>
        switch Js.Json.decodeArray(v) {
        | Some(arr) =>
          Some(
            arr->Belt.Array.keepMap(v =>
              switch Js.Json.decodeNumber(v) {
              | Some(n) => Some(n)
              | None => None
              }
            ),
          )
        | None => None
        }
      | None => None
      }
      let waterfall = switch Js.Dict.get(obj, "waterfall") {
      | Some(v) =>
        switch Js.Json.decodeArray(v) {
        | Some(arr) =>
          Some(
            arr->Belt.Array.keepMap(v =>
              switch Js.Json.decodeNumber(v) {
              | Some(n) => Some(n->Belt.Float.toInt)
              | None => None
              }
            ),
          )
        | None => None
        }
      | None => None
      }
      {waveform, waterfall}
    | None => {waveform: None, waterfall: None}
    }
  }
}

// Constants
let maxWaterfallRows = 200
let targetFPS = 30.0
let targetFrameTime = 1000.0 /. targetFPS

// Helper to format frequency for display
let formatFreq = (freq: float): string => {
  if freq < 1.0 {
    `${Js.Float.toFixedWithPrecision(freq *. 1000.0, ~digits=0)}kHz`
  } else {
    `${Js.Float.toFixedWithPrecision(freq, ~digits=2)}MHz`
  }
}

// Helper to convert dB to Y coordinate
let dbToY = (db: float, minDb: float, maxDb: float, spectrumHeight: int): float => {
  let normalized = (db -. minDb) /. (maxDb -. minDb)
  let clamped = Js.Math.max_float(0.0, Js.Math.min_float(1.0, normalized))
  float_of_int(spectrumHeight) -. 40.0 -. clamped *. (float_of_int(spectrumHeight) -. 60.0)
}

// Color gradient for waterfall (SDR++ style: blue to green to yellow to red)
let getWaterfallColor = (intensity: float): (int, int, int) => {
  if intensity < 0.33 {
    let t = intensity *. 3.0
    (0, Js.Math.floor_int(t *. 255.0), Js.Math.floor_int(255.0 -. t *. 255.0))
  } else if intensity < 0.66 {
    let t = (intensity -. 0.33) *. 3.0
    (Js.Math.floor_int(t *. 255.0), 255, 0)
  } else {
    let t = (intensity -. 0.66) *. 3.0
    (255, Js.Math.floor_int(255.0 -. t *. 255.0), 0)
  }
}

@react.component
let make = (~data: option<Js.Json.t>, ~frequencyRange: frequencyRange, ~activeSignalArea: string, ~isPaused: bool) => {
  // Canvas refs - using Dom.element type for ReactDOM.Ref.domRef compatibility
  let spectrumCanvasRef: React.ref<Js.nullable<Dom.element>> = React.useRef(Js.Nullable.null)
  let waterfallCanvasRef: React.ref<Js.nullable<Dom.element>> = React.useRef(Js.Nullable.null)

  // Context refs
  let spectrumCtxRef = React.useRef(None)
  let waterfallCtxRef = React.useRef(None)

  // Data refs for accessing latest values in animation loop
  let dataRef = React.useRef(data)
  let waterfallDataRef = React.useRef([])
  let frequencyRangeRef = React.useRef(frequencyRange)
  let activeSignalAreaRef = React.useRef(activeSignalArea)
  let isPausedRef = React.useRef(isPaused)

  // Animation refs
  let animationRef = React.useRef(None)
  let lastDrawTimeRef = React.useRef(0.0)

  // Keep refs updated with latest prop values
  React.useEffect1(() => {
    frequencyRangeRef.current = frequencyRange
    None
  }, [frequencyRange])

  React.useEffect1(() => {
    activeSignalAreaRef.current = activeSignalArea
    None
  }, [activeSignalArea])

  React.useEffect1(() => {
    isPausedRef.current = isPaused
    None
  }, [isPaused])

  // Draw spectrum function
let drawSpectrum = (spectrumCtx: Canvas2D.t, spectrumCanvas: Dom.element, currentData: SpectrumData.t) => {
    let spectrumWidth = CanvasOps.width(spectrumCanvas)
    let spectrumHeight = CanvasOps.height(spectrumCanvas)

    // Clear spectrum canvas
    Canvas2D.fillStyle(spectrumCtx, "#0a0a0a")
    Canvas2D.fillRect(spectrumCtx, 0.0, 0.0, float_of_int(spectrumWidth), float_of_int(spectrumHeight))

    switch currentData.waveform {
    | Some(waveform) if Belt.Array.length(waveform) > 0 =>
      let gridColor = "rgba(100, 200, 255, 0.1)"
      let lineColor = "#00d4ff"
      let minDb = -80.0
      let maxDb = 20.0

      // Draw horizontal grid lines
      Canvas2D.strokeStyle(spectrumCtx, gridColor)
      Canvas2D.lineWidth(spectrumCtx, 1.0)

      let dbGridLines = [-80.0, -60.0, -40.0, -20.0, 0.0, 20.0]
      Belt.Array.forEach(dbGridLines, db => {
        let y = dbToY(db, minDb, maxDb, spectrumHeight)
        Canvas2D.beginPath(spectrumCtx)
        Canvas2D.moveTo(spectrumCtx, 40.0, y)
        Canvas2D.lineTo(spectrumCtx, float_of_int(spectrumWidth) -. 40.0, y)
        Canvas2D.stroke(spectrumCtx)
      })

      // Draw vertical grid lines
      for i in 0 to 10 {
        let x = 40.0 +. float_of_int(i) *. (float_of_int(spectrumWidth) -. 80.0) /. 10.0
        Canvas2D.beginPath(spectrumCtx)
        Canvas2D.moveTo(spectrumCtx, x, 20.0)
        Canvas2D.lineTo(spectrumCtx, x, float_of_int(spectrumHeight) -. 40.0)
        Canvas2D.stroke(spectrumCtx)
      }

      // Draw spectrum
      let len = Belt.Array.length(waveform)
      let plotWidth = float_of_int(spectrumWidth) -. 80.0
      let binStep = plotWidth /. float_of_int(len)

      // Draw filled area from signal line down to bottom
      Canvas2D.beginPath(spectrumCtx)
      Canvas2D.moveTo(spectrumCtx, 40.0, float_of_int(spectrumHeight) -. 40.0)

      for i in 0 to len - 1 {
        let x = 40.0 +. float_of_int(i) *. binStep
        let y = dbToY(waveform[i], minDb, maxDb, spectrumHeight)
        Canvas2D.lineTo(spectrumCtx, x, y)
      }

      Canvas2D.lineTo(spectrumCtx, 40.0 +. plotWidth, float_of_int(spectrumHeight) -. 40.0)
      Canvas2D.closePath(spectrumCtx)

      // SDR++ style translucent blue fill
      Canvas2D.fillStyle(spectrumCtx, "rgba(0, 100, 255, 0.3)")
      Canvas2D.fill(spectrumCtx)

      // Draw thin line on top (SDR++ style peak line)
      Canvas2D.beginPath(spectrumCtx)
      Canvas2D.strokeStyle(spectrumCtx, lineColor)
      Canvas2D.lineWidth(spectrumCtx, 1.5)
      Canvas2D.lineJoin(spectrumCtx, "round")
      Canvas2D.lineCap(spectrumCtx, "round")

      for i in 0 to len - 1 {
        let x = 40.0 +. float_of_int(i) *. binStep
        let y = dbToY(waveform[i], minDb, maxDb, spectrumHeight)
        if i == 0 {
          Canvas2D.moveTo(spectrumCtx, x, y)
        } else {
          Canvas2D.lineTo(spectrumCtx, x, y)
        }
      }
      Canvas2D.stroke(spectrumCtx)

      // Draw dB scale labels (Y-axis)
      Canvas2D.fillStyle(spectrumCtx, "#666")
      Canvas2D.font(spectrumCtx, "16px JetBrains Mono")
      Canvas2D.textAlign(spectrumCtx, "right")

      let dbMarkers = [-80.0, -60.0, -40.0, -20.0, 0.0, 20.0]
      Belt.Array.forEach(dbMarkers, db => {
        let y = dbToY(db, minDb, maxDb, spectrumHeight)
        Canvas2D.fillText(spectrumCtx, `${Js.Float.toString(db)}`, 35.0, y +. 3.0)
      })

      // Draw frequency labels at bottom (X-axis)
      let currentFreqRange = frequencyRangeRef.current
      let minFreq = currentFreqRange.min
      let maxFreq = currentFreqRange.max
      let midFreq = (minFreq +. maxFreq) /. 2.0

      // Draw min and max frequency labels
      Canvas2D.fillStyle(spectrumCtx, "#e6e6e6")
      Canvas2D.font(spectrumCtx, "16px JetBrains Mono")
      Canvas2D.textAlign(spectrumCtx, "left")
      Canvas2D.fillText(spectrumCtx, formatFreq(minFreq), 40.0, float_of_int(spectrumHeight) -. 15.0)

      Canvas2D.textAlign(spectrumCtx, "right")
      Canvas2D.fillText(spectrumCtx, formatFreq(maxFreq), float_of_int(spectrumWidth) -. 40.0, float_of_int(spectrumHeight) -. 15.0)

      // Draw center frequency in white (larger font)
      Canvas2D.fillStyle(spectrumCtx, "#ffffff")
      Canvas2D.font(spectrumCtx, "bold 28px JetBrains Mono")
      Canvas2D.textAlign(spectrumCtx, "center")
      Canvas2D.fillText(spectrumCtx, formatFreq(midFreq), float_of_int(spectrumWidth) /. 2.0, float_of_int(spectrumHeight) -. 8.0)

    | _ => ()
    }
  }

  // Draw waterfall function
  let drawWaterfall = (waterfallCtx: Canvas2D.t, waterfallCanvas: Dom.element, currentData: SpectrumData.t) => {
    let waterfallWidth = CanvasOps.width(waterfallCanvas)
    let waterfallHeight = CanvasOps.height(waterfallCanvas)

    switch (currentData.waterfall, isPausedRef.current) {
    | (Some(waterfallRow), false) if Belt.Array.length(waterfallRow) > 0 =>
      // Add new row to the beginning (only when not paused)
      waterfallDataRef.current = Belt.Array.concat([waterfallRow], waterfallDataRef.current)
      // Keep only max rows
      if Belt.Array.length(waterfallDataRef.current) > maxWaterfallRows {
        waterfallDataRef.current = Belt.Array.slice(waterfallDataRef.current, ~offset=0, ~len=maxWaterfallRows)
      }

      // Create ImageData for faster rendering
      let imgData = Canvas2D.createImageData(waterfallCtx, waterfallWidth, waterfallHeight)
      let imgDataArray = imgData.data

      let rows = waterfallDataRef.current
      let rowHeight = float_of_int(waterfallHeight) /. float_of_int(maxWaterfallRows)

      for r in 0 to Belt.Array.length(rows) - 1 {
        let row = rows[r]
        let y = Js.Math.floor_int(float_of_int(r) *. rowHeight)
        let nextY = Js.Math.floor_int(float_of_int(r + 1) *. rowHeight)

        for yPixel in y to nextY - 1 {
          if yPixel < waterfallHeight {
            for i in 0 to Belt.Array.length(row) - 1 {
              let x = Js.Math.floor_int(float_of_int(i) /. float_of_int(Belt.Array.length(row)) *. float_of_int(waterfallWidth))
              let intensity = float_of_int(row[i]) /. 255.0
              let (rVal, gVal, bVal) = getWaterfallColor(intensity)

              let colWidth = Js.Math.ceil_int(float_of_int(waterfallWidth) /. float_of_int(Belt.Array.length(row)))
              for xPixel in x to x + colWidth - 1 {
                if xPixel < waterfallWidth {
                  let index = (yPixel * waterfallWidth + xPixel) * 4
                  Js.Typed_array.Uint8ClampedArray.unsafe_set(imgDataArray, index, rVal)
                  Js.Typed_array.Uint8ClampedArray.unsafe_set(imgDataArray, index + 1, gVal)
                  Js.Typed_array.Uint8ClampedArray.unsafe_set(imgDataArray, index + 2, bVal)
                  Js.Typed_array.Uint8ClampedArray.unsafe_set(imgDataArray, index + 3, 255)
                }
              }
            }
          }
        }
      }

      Canvas2D.putImageData(waterfallCtx, imgData, 0, 0)

    | _ => ()
    }
  }

  // Draw frame function
  let drawFrame = () => {
    switch (spectrumCtxRef.current, waterfallCtxRef.current) {
    | (Some(spectrumCtx), Some(waterfallCtx)) =>
      switch (Js.Nullable.toOption(spectrumCanvasRef.current), Js.Nullable.toOption(waterfallCanvasRef.current)) {
      | (Some(spectrumCanvas), Some(waterfallCanvas)) =>
        let currentData = SpectrumData.fromJson(dataRef.current->Belt.Option.getWithDefault(Js.Json.null))
        drawSpectrum(spectrumCtx, spectrumCanvas, currentData)
        drawWaterfall(waterfallCtx, waterfallCanvas, currentData)
      | _ => ()
      }
    | _ => ()
    }
  }

  // Animation loop
  let rec animate = () => {
    let currentTime = now()
    let timeSinceLastDraw = currentTime -. lastDrawTimeRef.current

    if timeSinceLastDraw >= targetFrameTime {
      lastDrawTimeRef.current = currentTime
      drawFrame()
    }

    let currentData = dataRef.current
    let hasData = switch currentData {
    | Some(json) =>
      let parsed = SpectrumData.fromJson(json)
      switch (parsed.waveform, parsed.waterfall) {
      | (Some(_), _) | (_, Some(_)) => true
      | _ => false
      }
    | None => false
    }

    if hasData {
      animationRef.current = Some(requestAnimationFrame(animate))
    } else {
      animationRef.current = None
    }
  }

  // Start animation
  let startAnimation = () => {
    switch animationRef.current {
    | Some(_) =>
      // Already animating, just trigger a redraw
      drawFrame()
    | None =>
      animationRef.current = Some(requestAnimationFrame(animate))
    }
  }

  // Effect to handle data changes
  React.useEffect1(() => {
    dataRef.current = data
    switch data {
    | Some(_) => startAnimation()
    | None => ()
    }
    None
  }, [data])

  // Effect to handle frequency range changes
  React.useEffect1(() => {
    frequencyRangeRef.current = frequencyRange
    // Redraw to update frequency labels
    drawFrame()
    None
  }, [frequencyRange])

  // Effect to initialize canvases and handle resize
  React.useEffect0(() => {
    switch (Js.Nullable.toOption(spectrumCanvasRef.current), Js.Nullable.toOption(waterfallCanvasRef.current)) {
    | (Some(spectrumCanvas), Some(waterfallCanvas)) =>
      // Get contexts
      let spectrumCtx = switch getContext(spectrumCanvas, "2d")->Js.Nullable.toOption {
      | Some(ctx) =>
        // Cast to Canvas2D.t - we know this is a 2d context
        Obj.magic(ctx)
      | None => failwith("Failed to get 2d context for spectrum canvas")
      }
      let waterfallCtx = switch getContext(waterfallCanvas, "2d")->Js.Nullable.toOption {
      | Some(ctx) => Obj.magic(ctx)
      | None => failwith("Failed to get 2d context for waterfall canvas")
      }

      spectrumCtxRef.current = Some(spectrumCtx)
      waterfallCtxRef.current = Some(waterfallCtx)

      let dpr = devicePixelRatio

      let resizeCanvases = () => {
        switch (parentElement(spectrumCanvas)->Js.Nullable.toOption, parentElement(waterfallCanvas)->Js.Nullable.toOption) {
        | (Some(spectrumWrapper), Some(waterfallWrapper)) =>
          let spectrumWidth = float_of_int(clientWidth(spectrumWrapper))
          let spectrumHeight = float_of_int(clientHeight(spectrumWrapper))
          let waterfallWidth = float_of_int(clientWidth(waterfallWrapper))
          let waterfallHeight = float_of_int(clientHeight(waterfallWrapper))

          CanvasOps.setWidth(spectrumCanvas, Js.Math.floor_int(spectrumWidth *. dpr))
          CanvasOps.setHeight(spectrumCanvas, Js.Math.floor_int(spectrumHeight *. dpr))
          CanvasOps.setWidth(waterfallCanvas, Js.Math.floor_int(waterfallWidth *. dpr))
          CanvasOps.setHeight(waterfallCanvas, Js.Math.floor_int(waterfallHeight *. dpr))
        | _ => ()
        }
      }

      resizeCanvases()
      addEventListener("resize", resizeCanvases)

      Some(() => {
        removeEventListener("resize", resizeCanvases)
        switch animationRef.current {
        | Some(id) => cancelAnimationFrame(id)
        | None => ()
        }
        animationRef.current = None
      })

    | _ => None
    }
  })

  // JSX
  <div className="flex-1 flex flex-col bg-[#0a0a0a] relative overflow-hidden p-5 gap-5">
    <div className="flex-[2] flex flex-col relative min-h-0">
      <div className="text-[11px] text-[#555] uppercase tracking-wider mb-2 flex items-center gap-2 after:content-['/'] after:text-[#444]">
        {React.string("Spectrum")}
      </div>
      <div className="flex-1 relative bg-[#0a0a0a] border border-[#1a1a1a] rounded overflow-hidden">
        <canvas ref={spectrumCanvasRef->ReactDOM.Ref.domRef} className="w-full h-full block" />
      </div>
    </div>
    <div className="flex-1 flex flex-col relative min-h-0">
      <div className="text-[11px] text-[#555] uppercase tracking-wider mb-2 flex items-center gap-2 after:content-['/'] after:text-[#444]">
        {React.string("Waterfall")}
      </div>
      <div className="flex-1 relative bg-[#0a0a0a] border border-[#1a1a1a] rounded overflow-hidden">
        <canvas ref={waterfallCanvasRef->ReactDOM.Ref.domRef} className="w-full h-full block" />
      </div>
    </div>
  </div>
}

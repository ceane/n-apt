// Stitcher Visualizer Component - ReScript implementation
// Canvas-based spectrum stitcher visualizer that uses WASM for spectrum stitching

// DOM element bindings
@get external clientWidth: Dom.element => int = "clientWidth"
@get external clientHeight: Dom.element => int = "clientHeight"
@scope("window") external addEventListener: (string, unit => unit) => unit = "addEventListener"
@scope("window") external removeEventListener: (string, unit => unit) => unit = "removeEventListener"

// Canvas 2D context bindings
@get external canvasWidth: Dom.element => int = "width"
@get external canvasHeight: Dom.element => int = "height"
@set external setCanvasWidth: (Dom.element, int) => unit = "width"
@set external setCanvasHeight: (Dom.element, int) => unit = "height"
@send external getContext: (Dom.element, string) => Js.Nullable.t<'ctx> = "getContext"
@get external parentElement: Dom.element => Js.Nullable.t<Dom.element> = "parentElement"

// File API bindings - using abstract types for File API
type file
type arrayBuffer = Js.Typed_array.ArrayBuffer.t

@send external arrayBuffer: file => Js.Promise.t<arrayBuffer> = "arrayBuffer"
@get external fileName: file => string = "name"

// Performance bindings
@scope("performance") external now: unit => float = "now"
@val external devicePixelRatio: float = "window.devicePixelRatio"

module CanvasOps = {
  let width = canvasWidth
  let height = canvasHeight
  let setWidth = setCanvasWidth
  let setHeight = setCanvasHeight
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
  @send external scale: (t, float, float) => unit = "scale"
}

// WASM module bindings
module SdrWasm = {
  // SpectrumStitcher class
  type stitcher

  @module("../sdr_wasm/sdr_wasm.js")
  external init: unit => Js.Promise.t<unit> = "default"

  @module("../sdr_wasm/sdr_wasm.js")
  @new
  external createStitcher: (int, float, float) => stitcher = "SpectrumStitcher"

  @send
  external addCapture: (stitcher, Js.Typed_array.Float32Array.t, float) => unit = "add_capture"

  @send
  external getFrequencies: stitcher => Js.Typed_array.Float64Array.t = "get_frequencies"

  @send
  external getPowerDb: stitcher => Js.Typed_array.Float32Array.t = "get_power_db"

  @send
  external getFrequencyRange: stitcher => array<float> = "get_frequency_range"
}

// Processing constants
let targetBins = 2048
let smoothingWindow = 5

// Props type for the component
type stitcherVisualizerProps = {
  selectedFiles: array<file>,
  onStitch: ((unit => unit) => unit),
}

// Helper to format frequency for display
let formatFreq = (freq: float): string => {
  let freqMHz = freq /. 1e6
  if Js.Math.abs_float(freqMHz) < 1.0 {
    `${Js.Float.toFixedWithPrecision(freqMHz *. 1000.0, ~digits=0)}kHz`
  } else {
    `${Js.Float.toFixedWithPrecision(freqMHz, ~digits=2)}MHz`
  }
}

// Parse frequency from filename (e.g., "iq_3.70MHz.c64" or "iq_500kHz.c64")
let parseFrequency = (filename: string): option<float> => {
  // Match pattern like "iq_3.70MHz.c64" or "iq_500kHz.c64"
  let regex = %re("/iq_(\\d+\\.?\\d*)([kM]Hz)/")
  switch Js.Re.exec_(regex, filename) {
  | Some(result) =>
    let matches = Js.Re.captures(result)
    let valueStr = matches[1]
    let unitStr = matches[2]
    switch (Js.Nullable.toOption(valueStr), Js.Nullable.toOption(unitStr)) {
    | (Some(valueStr), Some(unitStr)) =>
      switch Js.Float.fromString(valueStr) {
      | value =>
        if unitStr == "MHz" {
          Some(value *. 1e6)
        } else {
          Some(value *. 1e3)
        }
      | exception _ => None
      }
    | _ => None
    }
  | None => None
  }
}

// Bin/decimate data to target number of bins
let binData = (
  frequencies: Js.Typed_array.Float64Array.t,
  powerDb: Js.Typed_array.Float32Array.t,
  targetBins: int,
): (Js.Typed_array.Float64Array.t, Js.Typed_array.Float32Array.t) => {
  let len = Js.Typed_array.Float64Array.length(frequencies)
  if len <= targetBins {
    (frequencies, powerDb)
  } else {
    let binSize = Js.Math.ceil_int(float_of_int(len) /. float_of_int(targetBins))
    let binnedFreqs = Js.Typed_array.Float64Array.fromLength(targetBins)
    let binnedPower = Js.Typed_array.Float32Array.fromLength(targetBins)

    for i in 0 to targetBins - 1 {
      let startIdx = i * binSize
      let endIdx = Js.Math.min_int(startIdx + binSize, len)

      // Average frequencies and power within each bin
      let freqSum = ref(0.0)
      let powerSum = ref(0.0)
      let count = ref(0)

      for j in startIdx to endIdx - 1 {
        freqSum := freqSum.contents +. Js.Typed_array.Float64Array.unsafe_get(frequencies, j)
        // Convert from dB to linear for proper averaging, then back to dB
        powerSum := powerSum.contents +. Js.Math.pow_float(~base=10.0, ~exp=Js.Typed_array.Float32Array.unsafe_get(powerDb, j) /. 10.0)
        count := count.contents + 1
      }

      if count.contents > 0 {
        Js.Typed_array.Float64Array.unsafe_set(binnedFreqs, i, freqSum.contents /. float_of_int(count.contents))
        Js.Typed_array.Float32Array.unsafe_set(binnedPower, i, 10.0 *. Js.Math.log10(powerSum.contents /. float_of_int(count.contents)))
      }
    }

    (binnedFreqs, binnedPower)
  }
}

// Apply moving average smoothing
let smoothData = (powerDb: Js.Typed_array.Float32Array.t, windowSize: int): Js.Typed_array.Float32Array.t => {
  let len = Js.Typed_array.Float32Array.length(powerDb)
  let smoothed = Js.Typed_array.Float32Array.fromLength(len)
  let halfWindow = windowSize / 2

  for i in 0 to len - 1 {
    let sum = ref(0.0)
    let count = ref(0)

    let startJ = Js.Math.max_int(0, i - halfWindow)
    let endJ = Js.Math.min_int(len - 1, i + halfWindow)

    for j in startJ to endJ {
      // Use linear power for averaging
      sum := sum.contents +. Js.Math.pow_float(~base=10.0, ~exp=Js.Typed_array.Float32Array.unsafe_get(powerDb, j) /. 10.0)
      count := count.contents + 1
    }

    if count.contents > 0 {
      Js.Typed_array.Float32Array.unsafe_set(smoothed, i, 10.0 *. Js.Math.log10(sum.contents /. float_of_int(count.contents)))
    }
  }

  smoothed
}

// Process spectrum data (binning + smoothing)
let processSpectrum = (
  frequencies: Js.Typed_array.Float64Array.t,
  powerDb: Js.Typed_array.Float32Array.t,
): (Js.Typed_array.Float64Array.t, Js.Typed_array.Float32Array.t) => {
  // Step 1: Bin/decimate to target number of bins
  let (binnedFreqs, binnedPower) = binData(frequencies, powerDb, targetBins)

  // Step 2: Apply smoothing
  let smoothedPower = smoothData(binnedPower, smoothingWindow)

  (binnedFreqs, smoothedPower)
}

// Helper to convert dB to Y coordinate
let dbToY = (db: float, minDb: float, maxDb: float, height: int): float => {
  let normalized = (db -. minDb) /. (maxDb -. minDb)
  let clamped = Js.Math.max_float(0.0, Js.Math.min_float(1.0, normalized))
  float_of_int(height) -. 40.0 -. clamped *. (float_of_int(height) -. 60.0)
}

// Plot spectrum on canvas
let plotSpectrum = (
  ctx: Canvas2D.t,
  canvas: Dom.element,
  frequencies: Js.Typed_array.Float64Array.t,
  powerDb: Js.Typed_array.Float32Array.t,
) => {
  let len = Js.Typed_array.Float64Array.length(frequencies)
  if len == 0 {
    ()
  } else {
    let width = CanvasOps.width(canvas)
    let height = CanvasOps.height(canvas)

    // Clear canvas with SDR++ style background
    Canvas2D.fillStyle(ctx, "#0a0a0a")
    Canvas2D.fillRect(ctx, 0.0, 0.0, float_of_int(width), float_of_int(height))

    // Get frequency range
    let freqMin = ref(Js.Typed_array.Float64Array.unsafe_get(frequencies, 0))
    let freqMax = ref(Js.Typed_array.Float64Array.unsafe_get(frequencies, 0))

    for i in 1 to len - 1 {
      let freq = Js.Typed_array.Float64Array.unsafe_get(frequencies, i)
      if freq < freqMin.contents {
        freqMin := freq
      }
      if freq > freqMax.contents {
        freqMax := freq
      }
    }

    // Use fixed dB range with floor at -120 dB
    let minDb = -120.0
    let maxDb = 20.0

    // SDR++ style colors
    let gridColor = "rgba(100, 200, 255, 0.1)"
    let lineColor = "#00d4ff"

    // Draw horizontal grid lines
    Canvas2D.strokeStyle(ctx, gridColor)
    Canvas2D.lineWidth(ctx, 1.0)

    let dbMarkers = [-120.0, -100.0, -80.0, -60.0, -40.0, -20.0, 0.0, 20.0]
    Belt.Array.forEach(dbMarkers, db => {
      let y = dbToY(db, minDb, maxDb, height)
      Canvas2D.beginPath(ctx)
      Canvas2D.moveTo(ctx, 40.0, y)
      Canvas2D.lineTo(ctx, float_of_int(width) -. 40.0, y)
      Canvas2D.stroke(ctx)
    })

    // Draw vertical grid lines
    for i in 0 to 10 {
      let x = 40.0 +. float_of_int(i) *. (float_of_int(width) -. 80.0) /. 10.0
      Canvas2D.beginPath(ctx)
      Canvas2D.moveTo(ctx, x, 20.0)
      Canvas2D.lineTo(ctx, x, float_of_int(height) -. 40.0)
      Canvas2D.stroke(ctx)
    }

    // Draw spectrum (SDR++ style)
    let plotWidth = float_of_int(width) -. 80.0

    // Draw filled area from signal line down to bottom of canvas
    Canvas2D.beginPath(ctx)
    Canvas2D.moveTo(ctx, 40.0, float_of_int(height))

    for i in 0 to len - 1 {
      let freq = Js.Typed_array.Float64Array.unsafe_get(frequencies, i)
      let power = Js.Typed_array.Float32Array.unsafe_get(powerDb, i)
      let x = 40.0 +. ((freq -. freqMin.contents) /. (freqMax.contents -. freqMin.contents)) *. plotWidth
      let y = dbToY(power, minDb, maxDb, height)
      Canvas2D.lineTo(ctx, x, y)
    }

    Canvas2D.lineTo(ctx, 40.0 +. plotWidth, float_of_int(height))
    Canvas2D.closePath(ctx)

    // SDR++ style translucent blue fill
    Canvas2D.fillStyle(ctx, "rgba(0, 100, 255, 0.3)")
    Canvas2D.fill(ctx)

    // Draw thin line on top (SDR++ style peak line)
    Canvas2D.beginPath(ctx)
    Canvas2D.strokeStyle(ctx, lineColor)
    Canvas2D.lineWidth(ctx, 1.5)
    Canvas2D.lineJoin(ctx, "round")
    Canvas2D.lineCap(ctx, "round")

    for i in 0 to len - 1 {
      let freq = Js.Typed_array.Float64Array.unsafe_get(frequencies, i)
      let power = Js.Typed_array.Float32Array.unsafe_get(powerDb, i)
      let x = 40.0 +. ((freq -. freqMin.contents) /. (freqMax.contents -. freqMin.contents)) *. plotWidth
      let y = dbToY(power, minDb, maxDb, height)
      if i == 0 {
        Canvas2D.moveTo(ctx, x, y)
      } else {
        Canvas2D.lineTo(ctx, x, y)
      }
    }
    Canvas2D.stroke(ctx)

    // Draw dB scale labels (Y-axis)
    Canvas2D.fillStyle(ctx, "#666")
    Canvas2D.font(ctx, "16px JetBrains Mono")
    Canvas2D.textAlign(ctx, "right")

    Belt.Array.forEach(dbMarkers, db => {
      let y = dbToY(db, minDb, maxDb, height)
      Canvas2D.fillText(ctx, `${Js.Float.toString(db)}`, 35.0, y +. 3.0)
    })

    // Draw frequency labels at bottom (X-axis)
    let midFreq = (freqMin.contents +. freqMax.contents) /. 2.0

    // Draw min and max frequency labels
    Canvas2D.fillStyle(ctx, "#e6e6e6")
    Canvas2D.font(ctx, "16px JetBrains Mono")
    Canvas2D.textAlign(ctx, "left")
    Canvas2D.fillText(ctx, formatFreq(freqMin.contents), 40.0, float_of_int(height) -. 15.0)

    Canvas2D.textAlign(ctx, "right")
    Canvas2D.fillText(ctx, formatFreq(freqMax.contents), float_of_int(width) -. 40.0, float_of_int(height) -. 15.0)

    // Draw center frequency in white (larger font)
    Canvas2D.fillStyle(ctx, "#ffffff")
    Canvas2D.font(ctx, "bold 28px JetBrains Mono")
    Canvas2D.textAlign(ctx, "center")
    Canvas2D.fillText(ctx, formatFreq(midFreq), float_of_int(width) /. 2.0, float_of_int(height) -. 8.0)
  }
}

@react.component
let make = (~selectedFiles: array<file>, ~onStitch: (unit => unit) => unit) => {
  // Refs
  let canvasRef: React.ref<Js.nullable<Dom.element>> = React.useRef(Js.Nullable.null)
  let ctxRef = React.useRef(None)
  let processedDataRef = React.useRef(None)
  let redrawTriggerRef = React.useRef(0)
  let handlerRegisteredRef = React.useRef(false)
  let stitchFilesRef = React.useRef(() => ())

  // State
  let (status, setStatus) = React.useState(() => "Select files to begin stitching")
  let (processingTime, setProcessingTime) = React.useState(() => 0.0)
  let (numPoints, setNumPoints) = React.useState(() => 0)
  let (freqRange, setFreqRange) = React.useState(() => "0 - 0 MHz")
  let (showResults, setShowResults) = React.useState(() => false)
  let (isInitialized, setIsInitialized) = React.useState(() => false)

  // Register stitch handler with parent
  React.useEffect1(() => {
    if !handlerRegisteredRef.current {
      let handler = () => {
        stitchFilesRef.current()
      }
      onStitch(handler)
      handlerRegisteredRef.current = true
    }
    None
  }, [onStitch])

  // Initialize WASM module
  React.useEffect0(() => {
    let initWasm = async () => {
      try {
        await SdrWasm.init()
        setIsInitialized(_ => true)
        setStatus(_ => "WASM initialized. Select .c64 files.")
      } catch {
      | error =>
        let errorMessage = switch Js.Json.stringifyAny(error) {
        | Some(msg) => msg
        | None => "Unknown error"
        }
        setStatus(_ => `Error initializing WASM: ${errorMessage}`)
      }
    }

    let _ = initWasm()
    None
  })

  // Initialize canvas context
  React.useEffect0(() => {
    switch Js.Nullable.toOption(canvasRef.current) {
    | Some(canvas) =>
      let ctx = switch getContext(canvas, "2d")->Js.Nullable.toOption {
      | Some(ctx) => Obj.magic(ctx)
      | None => failwith("Failed to get 2d context")
      }
      ctxRef.current = Some(ctx)

      let dpr = devicePixelRatio

      let resizeCanvas = () => {
        switch parentElement(canvas)->Js.Nullable.toOption {
        | Some(wrapper) =>
          let w = clientWidth(wrapper)
          let h = clientHeight(wrapper)
          CanvasOps.setWidth(canvas, Js.Math.floor_int(float_of_int(w) *. dpr))
          CanvasOps.setHeight(canvas, Js.Math.floor_int(float_of_int(h) *. dpr))
          Canvas2D.scale(ctx, dpr, dpr)

          // Redraw the spectrum if we have processed data
          switch processedDataRef.current {
          | Some(_) => redrawTriggerRef.current = redrawTriggerRef.current + 1
          | None => ()
          }
        | None => ()
        }
      }

      resizeCanvas()
      addEventListener("resize", resizeCanvas)

      Some(() => {
        removeEventListener("resize", resizeCanvas)
      })

    | None => None
    }
  })

  // Watch for redraw triggers and plot spectrum when data is ready
  React.useEffect1(() => {
    switch (processedDataRef.current, ctxRef.current) {
    | (Some((frequencies, powerDb)), Some(ctx)) =>
      switch Js.Nullable.toOption(canvasRef.current) {
      | Some(canvas) =>
        plotSpectrum(ctx, canvas, frequencies, powerDb)
      | None => ()
      }
    | _ => ()
    }
    None
  }, [redrawTriggerRef.current])

  // Stitch files function
  let stitchFiles = async () => {
    if !isInitialized {
      setStatus(_ => "WASM not initialized yet...")
      ()
    } else if Belt.Array.length(selectedFiles) == 0 {
      setStatus(_ => "No files selected")
      ()
    } else {
      setStatus(_ => "Processing...")
      let startTime = now()

      try {
        let stitcher = SdrWasm.createStitcher(262144, 3.2e6, -100.0)

        let validFiles = Belt.Array.keep(selectedFiles, file => fileName(file) != "")

        if Belt.Array.length(validFiles) == 0 {
          setStatus(_ => "No valid files selected")
        } else {
          for i in 0 to Belt.Array.length(validFiles) - 1 {
            let file = validFiles[i]
            let name = fileName(file)
            let centerFreq = parseFrequency(name)

            switch centerFreq {
            | Some(freq) =>
              setStatus(_ => `Processing ${Js.Int.toString(i + 1)}/${Js.Int.toString(Belt.Array.length(validFiles))}: ${name}...`)

              let buffer = await arrayBuffer(file)
              // Ensure data length is a multiple of 4 (Float32)
              let validLength = Js.Math.floor_int(float_of_int(Js.Typed_array.ArrayBuffer.byteLength(buffer)) /. 4.0) * 4
              let validData = Js.Typed_array.ArrayBuffer.slice(~start=0, ~end_=validLength, buffer)
              let iqData = Js.Typed_array.Float32Array.fromBuffer(validData)

              SdrWasm.addCapture(stitcher, iqData, freq)
            | None =>
              Js.Console.warn(`Skipping ${name} - couldn't parse frequency`)
            }
          }

          let elapsedTime = now() -. startTime

          // Get raw results from WASM
          let rawFrequencies = SdrWasm.getFrequencies(stitcher)
          let rawPowerDb = SdrWasm.getPowerDb(stitcher)
          let freqRangeResult = SdrWasm.getFrequencyRange(stitcher)

          let (minFreq, maxFreq) = switch freqRangeResult {
          | [min, max] => (min, max)
          | _ => (0.0, 0.0)
          }

          // Process the spectrum (binning + smoothing)
          let (processedFreqs, processedPower) = processSpectrum(rawFrequencies, rawPowerDb)

          // Store processed data for redraw on resize
          processedDataRef.current = Some((processedFreqs, processedPower))

          // Update info
          setNumPoints(_ => Js.Typed_array.Float64Array.length(processedFreqs))
          setFreqRange(_ => `${formatFreq(minFreq)} - ${formatFreq(maxFreq)}`)
          setProcessingTime(_ => elapsedTime)
          setShowResults(_ => true)

          // Trigger a redraw of the spectrum
          redrawTriggerRef.current = redrawTriggerRef.current + 1

          setStatus(_ => `✓ Stitching complete! Processed ${Js.Int.toString(Belt.Array.length(selectedFiles))} captures in ${Js.Float.toString(elapsedTime)} ms`)
        }
      } catch {
      | error =>
        let errorMessage = switch Js.Json.stringifyAny(error) {
        | Some(msg) => msg
        | None => "Unknown error"
        }
        setStatus(_ => `Error: ${errorMessage}`)
        Js.Console.error2("Stitching error:", error)
      }
    }
  }

  // Store stitchFiles in ref immediately after definition
  stitchFilesRef.current = () => {
    let _ = stitchFiles()
    ()
  }

  <div className="flex-1 flex flex-col bg-[#0a0a0a] relative overflow-hidden p-5 gap-5">
    <div className="flex-1 flex flex-col relative min-h-0">
      <div className="text-[11px] text-[#555] uppercase tracking-wider mb-2 flex items-center gap-2 after:content-['/'] after:text-[#444]">
        {React.string("Stitcher Visualizer")}
      </div>
      <div className="flex-1 relative bg-[#0a0a0a] border border-[#1a1a1a] rounded overflow-hidden">
        <div
          className="absolute top-2.5 right-5 font-mono text-xs px-3 py-2 rounded z-10"
          style={ReactDOM.Style.make(
            ~color=isInitialized ? "#0f0" : "#f00",
            ~backgroundColor="rgba(0, 0, 0, 0.8)",
            ()
          )}>
          {React.string(status)}
        </div>
        <canvas ref={canvasRef->ReactDOM.Ref.domRef} className="w-full h-full block" />
      </div>
      {showResults
        ? <div className="bg-[#1a1a1a] p-4 rounded mt-2.5 text-sm font-mono text-[#666]">
            <div>{React.string(`Frequency Points: ${Js.Int.toString(numPoints)}`)}</div>
            <div>{React.string(`Frequency Range: ${freqRange}`)}</div>
            <div>{React.string(`Processing Time: ${Js.Float.toString(processingTime)} ms`)}</div>
          </div>
        : React.null}
    </div>
  </div>
}

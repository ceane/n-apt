// DrawMockNAPT Component - ReScript implementation
// APT (Automatic Picture Transmission) frequency comb visualization

// Recharts bindings
module Recharts = {
  module LineChart = {
    @module("recharts") @react.component
    external make: (
      ~data: array<'data>,
      ~children: React.element,
    ) => React.element = "LineChart"
  }

  module Line = {
    @module("recharts") @react.component
    external make: (
      ~type_: string=?,
      ~dataKey: string,
      ~stroke: string=?,
      ~strokeWidth: int=?,
      ~dot: bool=?,
      ~name: string=?,
    ) => React.element = "Line"
  }

  module XAxis = {
    @module("recharts") @react.component
    external make: (
      ~dataKey: string=?,
      ~label: {"value": string, "position": string, "offset": int}=?,
    ) => React.element = "XAxis"
  }

  module YAxis = {
    @module("recharts") @react.component
    external make: (
      ~label: {"value": string, "angle": int, "position": string}=?,
    ) => React.element = "YAxis"
  }

  module CartesianGrid = {
    @module("recharts") @react.component
    external make: (~strokeDasharray: string=?) => React.element = "CartesianGrid"
  }

  module Tooltip = {
    @module("recharts") @react.component
    external make: unit => React.element = "Tooltip"
  }

  module Legend = {
    @module("recharts") @react.component
    external make: unit => React.element = "Legend"
  }

  module ResponsiveContainer = {
    @module("recharts") @react.component
    external make: (
      ~width: string=?,
      ~height: int,
      ~children: React.element,
    ) => React.element = "ResponsiveContainer"
  }
}

// Input bindings for range slider
@val @scope("Math")
external mathMax: (float, float) => float = "max"

@val @scope("Math")
external mathMin: (float, float) => float = "min"

// Signal parameters type
type signalParams = {
  spikeCount: int,
  spikeWidth: float,
  centerSpikeBoost: float,
  floorAmplitude: float,
  decayRate: float,
  baselineModulation: float,
  envelopeWidth: float,
}

// Data point type
type dataPoint = {
  t: float,
  freq: float,
  x: float,
}

// Calculate X value for a given t and parameters
let calculateX = (t: float, params: signalParams): float => {
  let n = params.spikeCount
  let half = (n - 1) / 2

  // Uniform tooth spacing
  let spacing = 2.0 /. Belt.Int.toFloat(n - 1)

  // Tooth half-width as fraction of spacing
  let halfWidth = params.spikeWidth *. spacing /. 2.0

  let rec calculateSum = (k: int, acc: float): float => {
    if k > half {
      acc
    } else {
      let centerPos = Belt.Int.toFloat(k) *. spacing
      let dx = t -. centerPos

      // Finite support guarantees baseline = 0
      if Js.Math.abs_float(dx) > halfWidth {
        calculateSum(k + 1, acc)
      } else {
        // Sine wave tooth
        let local = dx /. halfWidth
        let tooth = Js.Math.sin(Js.Math._PI *. (local +. 1.0) /. 2.0)

        let height = if k == 0 {
          // Center tooth (absolute dominant)
          Js.Math.max_float(1.0 *. params.centerSpikeBoost, 1.05)
        } else {
          let centerHeight = Js.Math.max_float(1.0 *. params.centerSpikeBoost, 1.05)
          let effectiveFloor = Js.Math.min_float(params.floorAmplitude, Js.Math.min_float(1.0, centerHeight))
          let decay = Js.Math.exp(-.Belt.Int.toFloat(Js.Math.abs_int(k)) *. params.decayRate)
          effectiveFloor +. (centerHeight -. effectiveFloor) *. decay
        }

        calculateSum(k + 1, acc +. height *. tooth)
      }
    }
  }

  // Also calculate for negative k values
  let rec calculateNegativeSum = (k: int, acc: float): float => {
    if k < -half {
      acc
    } else if k == 0 {
      calculateNegativeSum(k - 1, acc)
    } else {
      let centerPos = Belt.Int.toFloat(k) *. spacing
      let dx = t -. centerPos

      if Js.Math.abs_float(dx) > halfWidth {
        calculateNegativeSum(k - 1, acc)
      } else {
        let local = dx /. halfWidth
        let tooth = Js.Math.sin(Js.Math._PI *. (local +. 1.0) /. 2.0)

        let centerHeight = Js.Math.max_float(1.0 *. params.centerSpikeBoost, 1.05)
        let effectiveFloor = Js.Math.min_float(params.floorAmplitude, Js.Math.min_float(1.0, centerHeight))
        let decay = Js.Math.exp(-.Belt.Int.toFloat(Js.Math.abs_int(k)) *. params.decayRate)
        let height = effectiveFloor +. (centerHeight -. effectiveFloor) *. decay

        calculateNegativeSum(k - 1, acc +. height *. tooth)
      }
    }
  }

  let y = calculateSum(0, 0.0) +. calculateNegativeSum(0, 0.0)

  // Gaussian envelope
  let envelope = Js.Math.exp(-.Js.Math.pow_float(~base=t /. params.envelopeWidth, ~exp=2.0))
  let modulation = params.baselineModulation *. 0.1 *. Js.Math.sin(2.0 *. Js.Math._PI *. t *. 10.0)
  let envelopedY = y *. envelope
  let valleyMod = if envelopedY < 0.1 { modulation } else { 0.0 }
  envelopedY +. valleyMod
}

// Generate data points
let generateData = (params: signalParams): array<dataPoint> => {
  let steps = 5000
  let points = Belt.Array.makeUninitializedUnsafe(steps + 1)

  for i in 0 to steps {
    let t = -1.0 +. (2.0 *. Belt.Int.toFloat(i)) /. Belt.Int.toFloat(steps)
    let freq = ((t +. 1.0) /. 2.0) *. 3.0 // 0 to 3 MHz
    let x = calculateX(t, params)

    Belt.Array.setExn(points, i, {
      t: Js.Float.toFixedWithPrecision(t, ~digits=4)->Belt.Float.fromString->Belt.Option.getWithDefault(0.0),
      freq: Js.Float.toFixedWithPrecision(freq, ~digits=4)->Belt.Float.fromString->Belt.Option.getWithDefault(0.0),
      x: x,
    })
  }

  points
}

// Export to SVG
@scope("document") external createElement: string => Dom.element = "createElement"
@scope("URL") external createObjectURL: 'blob => string = "createObjectURL"
@scope("URL") external revokeObjectURL: string => unit = "revokeObjectURL"
@new external blob: (array<string>, {"type": string}) => 'blob = "Blob"
@send external appendChild: (Dom.element, Dom.element) => unit = "appendChild"
@send external removeChild: (Dom.element, Dom.element) => unit = "removeChild"
@set external setHref: (Dom.element, string) => unit = "href"
@set external setDownload: (Dom.element, string) => unit = "download"
@send external click: Dom.element => unit = "click"
@scope("document") external body: Dom.element = "body"

let exportToSVG = (params: signalParams): unit => {
  let data = generateData(params)

  let width = 1400
  let height = 400
  let padding = 50

  // Find min/max values
  let (xMin, xMax) = Belt.Array.reduce(data, (0.0, 0.0), ((min, max), point) => {
    (Js.Math.min_float(min, point.t), Js.Math.max_float(max, point.t))
  })
  let yMax = Belt.Array.reduce(data, 0.0, (acc, point) => {
    Js.Math.max_float(acc, point.x)
  }) *. 1.1

  let xScale = Belt.Int.toFloat(width - 2 * padding) /. (xMax -. xMin)
  let yScale = Belt.Int.toFloat(height - 2 * padding) /. yMax

  // Build path data
  let pathData = Belt.Array.reduceWithIndex(data, "", (acc, point, index) => {
    let x = Belt.Int.toFloat(padding) +. (point.t -. xMin) *. xScale
    let y = Belt.Int.toFloat(height - padding) -. point.x *. yScale

    let cmd = if index == 0 {
      `M ${Js.Float.toFixedWithPrecision(x, ~digits=2)},${Js.Float.toFixedWithPrecision(y, ~digits=2)}`
    } else {
      ` L ${Js.Float.toFixedWithPrecision(x, ~digits=2)},${Js.Float.toFixedWithPrecision(y, ~digits=2)}`
    }
    acc ++ cmd
  })

  let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${Belt.Int.toString(width)}" height="${Belt.Int.toString(height)}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${Belt.Int.toString(width)}" height="${Belt.Int.toString(height)}" fill="#0a0a0a"/>

  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a1a1a" stroke-width="0.5"/>
    </pattern>

    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="${Belt.Int.toString(width)}" height="${Belt.Int.toString(height)}" fill="url(#grid)"/>

  <path d="${pathData}"
        fill="none"
        stroke="#00d4ff"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter="url(#glow)"/>

  <line x1="${Belt.Int.toString(padding)}" y1="${Belt.Int.toString(height - padding)}"
        x2="${Belt.Int.toString(width - padding)}" y2="${Belt.Int.toString(height - padding)}"
        stroke="#444" stroke-width="1"/>
  <line x1="${Belt.Int.toString(padding)}" y1="${Belt.Int.toString(padding)}"
        x2="${Belt.Int.toString(padding)}" y2="${Belt.Int.toString(height - padding)}"
        stroke="#444" stroke-width="1"/>
</svg>`

  let blobObj = blob([svgContent], {"type": "image/svg+xml"})
  let url = createObjectURL(blobObj)
  let link = createElement("a")
  setHref(link, url)
  setDownload(link, "frequency-comb-waveform.svg")
  appendChild(body, link)
  click(link)
  removeChild(body, link)
  revokeObjectURL(url)
}

@react.component
let make = () => {
  // Spike and waveform parameters
  let (spikeCount, setSpikeCount) = React.useState(() => 150)
  let (spikeWidth, setSpikeWidth) = React.useState(() => 0.5)
  let (centerSpikeBoost, setCenterSpikeBoost) = React.useState(() => 2.5)
  let (floorAmplitude, setFloorAmplitude) = React.useState(() => 1.0)
  let (decayRate, setDecayRate) = React.useState(() => 0.5)
  let (baselineModulation, setBaselineModulation) = React.useState(() => 0.0)
  let (envelopeWidth, setEnvelopeWidth) = React.useState(() => 10.0)

  let params: signalParams = {
    spikeCount: spikeCount,
    spikeWidth: spikeWidth,
    centerSpikeBoost: centerSpikeBoost,
    floorAmplitude: floorAmplitude,
    decayRate: decayRate,
    baselineModulation: baselineModulation,
    envelopeWidth: envelopeWidth,
  }

  let data = React.useMemo1(() => {
    generateData(params)
  }, [params])

  let handleExport = React.useCallback1(() => {
    exportToSVG(params)
  }, [params])

  <div className="w-full h-full p-6 bg-gray-50 dark:bg-gray-900">
    <div className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4 text-center dark:text-white">
        {React.string("APT Frequency Comb")}
      </h2>

      <div className="mb-6">
        <Recharts.ResponsiveContainer width="100%" height={400}>
          <Recharts.LineChart data={data}>
            <Recharts.CartesianGrid strokeDasharray="3 3" />
            <Recharts.XAxis
              dataKey="freq"
              label={{"value": "Frequency (MHz)", "position": "insideBottom", "offset": -5}}
            />
            <Recharts.YAxis
              label={{"value": "x(t)", "angle": -90, "position": "insideLeft"}}
            />
            <Recharts.Tooltip />
            <Recharts.Legend />
            <Recharts.Line
              type_="monotone"
              dataKey="x"
              stroke="#2563eb"
              dot={false}
              strokeWidth={2}
              name="x(t)"
            />
          </Recharts.LineChart>
        </Recharts.ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Spike Count: ${Belt.Int.toString(spikeCount)}`)}
          </label>
          <input
            type_="range"
            min="3"
            max="200"
            step={1.0}
            value={spikeCount->Belt.Int.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setSpikeCount(_ => Belt.Int.fromString(value)->Belt.Option.getWithDefault(150))
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Spike Width Ratio: ${Js.Float.toFixedWithPrecision(spikeWidth, ~digits=2)}`)}
          </label>
          <input
            type_="range"
            min="0.01"
            max="1.0"
            step={0.01}
            value={spikeWidth->Js.Float.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setSpikeWidth(_ => Belt.Float.fromString(value)->Belt.Option.getWithDefault(0.5))
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Center Spike Boost: ${Js.Float.toFixedWithPrecision(centerSpikeBoost, ~digits=2)}x`)}
          </label>
          <input
            type_="range"
            min="1.05"
            max="5.0"
            step={0.01}
            value={centerSpikeBoost->Js.Float.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setCenterSpikeBoost(_ => Belt.Float.fromString(value)->Belt.Option.getWithDefault(2.5))
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Floor Amplitude: ${Js.Float.toFixedWithPrecision(floorAmplitude, ~digits=2)}`)}
          </label>
          <input
            type_="range"
            min="0.1"
            max="1.0"
            step={0.01}
            value={floorAmplitude->Js.Float.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setFloorAmplitude(_ => Belt.Float.fromString(value)->Belt.Option.getWithDefault(1.0))
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Decay Rate: ${Js.Float.toFixedWithPrecision(decayRate, ~digits=2)}`)}
          </label>
          <input
            type_="range"
            min="0.1"
            max="5.0"
            step={0.1}
            value={decayRate->Js.Float.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setDecayRate(_ => Belt.Float.fromString(value)->Belt.Option.getWithDefault(0.5))
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Baseline Modulation: ${Js.Float.toFixedWithPrecision(baselineModulation, ~digits=2)}`)}
          </label>
          <input
            type_="range"
            min="0.0"
            max="1.0"
            step={0.01}
            value={baselineModulation->Js.Float.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setBaselineModulation(_ => Belt.Float.fromString(value)->Belt.Option.getWithDefault(0.0))
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-300">
            {React.string(`Envelope Width: ${Js.Float.toFixedWithPrecision(envelopeWidth, ~digits=2)}`)}
          </label>
          <input
            type_="range"
            min="0.1"
            max="2.0"
            step={0.01}
            value={envelopeWidth->Js.Float.toString}
            onChange={e => {
              let value = (ReactEvent.Form.target(e))["value"]
              setEnvelopeWidth(_ => Belt.Float.fromString(value)->Belt.Option.getWithDefault(10.0))
            }}
            className="w-full"
          />
        </div>
      </div>

      <button
        onClick={_ => handleExport()}
        className="mt-4 px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600"
      >
        {React.string("Export as SVG")}
      </button>

      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900 rounded">
        <h3 className="font-semibold mb-2 dark:text-white">{React.string("About:")}</h3>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {React.string(`APT (Automatic Picture Transmission) frequency comb with ${Belt.Int.toString(spikeCount)} spikes. Sine wave profiles with exponential height decay from center to floor, modulated by Gaussian envelope.`)}
        </p>
      </div>
    </div>
  </div>
}

let default = make

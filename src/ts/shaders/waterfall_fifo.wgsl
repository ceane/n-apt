@group(0) @binding(0) var dataTex: texture_2d<f32>;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: array<vec4<f32>, 5>;

struct VertexOut { @builtin(position) position: vec4<f32> }

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return VertexOut(vec4<f32>(pos[vi], 0.0, 1.0));
}

// Helper: look up a raw dB value from the circular buffer
fn sampleDb(col: i32, displayRow: i32, renderRow: i32, texH: i32) -> f32 {
  var texRow = renderRow - displayRow;
  if (texRow < 0) { texRow = texRow + texH; }
  return textureLoad(dataTex, vec2<i32>(col, texRow), 0).r;
}

// Helper: normalise dB → [0,1] then map through colour LUT
fn dbToColor(rawDb: f32, dbMin: f32, dbMax: f32, colorCount: f32) -> vec4<f32> {
  let range = max(dbMax - dbMin, 0.001);
  let onscreen = clamp((rawDb - dbMin) / range, 0.0, 1.0);
  let onscreenColorMax = 0.58;
  let overrangeHeadroom = min(24.0, max(6.0, range * 0.25));
  let overrange = clamp((rawDb - dbMax) / overrangeHeadroom, 0.0, 1.0);
  let normalized = select(
    onscreen * onscreenColorMax,
    onscreenColorMax + (1.0 - onscreenColorMax) * overrange,
    rawDb > dbMax,
  );
  var ci = i32(round(normalized * (colorCount - 1.0)));
  ci = clamp(ci, 0, i32(colorCount) - 1);
  return textureLoad(colorTex, vec2<i32>(ci, 0), 0);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let px = position.xy;

  // uniforms[0] = (plotW, plotH, marginX, marginY) — physical pixels
  let plotW  = uniforms[0].x;
  let plotH  = uniforms[0].y;
  let margX  = uniforms[0].z;
  let margY  = uniforms[0].w;

  let xIn = px.x - margX;
  let yIn = px.y - margY;
  let inBounds = xIn >= 0.0 && yIn >= 0.0 && xIn < plotW && yIn < plotH;

  // uniforms[1] = (renderRow, texW, texH, colorCount)
  let renderRow  = i32(uniforms[1].x);
  let texW       = i32(uniforms[1].y);
  let texH       = i32(uniforms[1].z);
  let colorCount = max(1.0, uniforms[1].w);
  let fTexW      = f32(texW);

  // uniforms[2] = (dbMin, dbMax, wfSmooth, historyZoom)
  let dbMin    = uniforms[2].x;
  let dbMax    = uniforms[2].y;
  let wfSmooth = uniforms[2].z > 0.5;
  let historyZoom = max(uniforms[2].w, 1.0);

  // uniforms[3] = immutable-history normalized pan, bin subset mode, bin parity
  let historyPan = uniforms[3].x;
  let binSubsetMode = i32(uniforms[3].y);
  let binSubsetParity = i32(uniforms[3].z);

  // uniforms[4] = background RGBA
  let bg = uniforms[4];

  if (!inBounds) {
    return bg;
  }

  // y: 1:1 mapping (texH == plotH by construction)
  let displayRow = clamp(i32(floor(yIn)), 0, texH - 1);

  // Map display x → bin index
  // Use center-aligned sampling (px + 0.5) to avoid sub-pixel flickering
  let xCenter = xIn + 0.5;
  let displayX = xCenter / max(plotW, 1.0);
  let sourceX = 0.5 + (displayX - 0.5) / historyZoom;
  let sampledSourceX = clamp(
    sourceX + historyPan,
    0.0,
    1.0,
  );
  let selectedBinCount = max(1.0, ceil(fTexW / 2.0));
  let sourceBinCount = select(fTexW, selectedBinCount, binSubsetMode == 1);
  // Preserve discrete FFT-bin edges once zoom gives each visible bin enough
  // pixels to render as a step. Interpolating in this regime creates the wide
  // blurred bands seen in the zoomed analysis waterfall.
  let visibleSourceBinCount = sourceBinCount / historyZoom;
  let isSteps = plotW / max(visibleSourceBinCount, 1.0) >= 3.0;
  let exactBin = sampledSourceX * sourceBinCount;

  var finalColor: vec4<f32>;

  if (wfSmooth && !isSteps) {
    // SMOOTH MODE: linear interpolation between adjacent bins
    let lenMinusOne = max(sourceBinCount - 1.0, 1.0);
    // Scale xCenter to [0, lenMinusOne] range for interpolation
    let exactIdx = sampledSourceX * lenMinusOne;
    let selectedBinFloor = i32(floor(exactIdx));
    let selectedBinCeil  = min(selectedBinFloor + 1, i32(sourceBinCount) - 1);
    let idxFloor = clamp(select(selectedBinFloor, selectedBinFloor * 2 + binSubsetParity, binSubsetMode == 1), 0, texW - 1);
    let idxCeil = clamp(select(selectedBinCeil, selectedBinCeil * 2 + binSubsetParity, binSubsetMode == 1), 0, texW - 1);
    let frac     = exactIdx - f32(selectedBinFloor);

    let dbFloor = sampleDb(max(idxFloor, 0), displayRow, renderRow, texH);
    let dbCeil  = sampleDb(idxCeil, displayRow, renderRow, texH);
    let rawDb   = mix(dbFloor, dbCeil, clamp(frac, 0.0, 1.0));
    finalColor = dbToColor(rawDb, dbMin, dbMax, colorCount);
  } else {
    // DEFAULT: nearest-neighbour
    let selectedBin = i32(floor(exactBin));
    let col = clamp(select(selectedBin, selectedBin * 2 + binSubsetParity, binSubsetMode == 1), 0, texW - 1);
    let rawDb = sampleDb(col, displayRow, renderRow, texH);
    finalColor = dbToColor(rawDb, dbMin, dbMax, colorCount);
  }

  return finalColor;
}

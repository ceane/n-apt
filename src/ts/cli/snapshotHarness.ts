import { buildCliSnapshotModel } from "@n-apt/cli/snapshotModel";
import {
  resolveCliSnapshotDimensions,
  type CliSnapshotAspectRatio,
} from "@n-apt/cli/snapshotPolicy";
import {
  getZoomedSlice,
  SNAPSHOT_VIDEO_MIME_TYPES,
  buildSnapshotStatsLines,
  createAnimatedSvgFromFrames,
  extractSvgContent,
  generateSvgWithSymbols,
  normalizeSnapshotVideoFrameRate,
  renderSpectrumSnapshotCanvas,
  renderSpectrumSnapshotSvg,
  renderStatsRowCanvas,
  renderWaterfallSnapshotCanvas,
  sampleFramesEvenly,
} from "@n-apt/capture/hooks/useSnapshot";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import { THEME_TOKENS } from "@n-apt/consts/theme";
import { formatTimestampWithTimezone } from "@n-apt/math/formatters";
import type { SnapshotData } from "@n-apt/spectrum/FFTCanvas";
import type { SnapshotTheme } from "@n-apt/layout/rendering/SnapshotRenderer";

type HarnessFormat = "png" | "svg" | "animated-svg" | "webm" | "mp4";

type HarnessRequest = {
  iqFrames: number[][];
  centerFrequencyHz: number;
  sampleRateHz: number;
  snapshotTimestamp: number;
  deviceName: string;
  gainDb: number;
  ppm: number;
  fftSize: number;
  powerScale: "dB" | "dBm";
  dbMin: number;
  dbMax: number;
  waterfall: boolean;
  grid: boolean;
  stats: boolean;
  theme: "dark" | "light";
  useThemeColors: boolean;
  fftColor?: string | null;
  frequencyRange?: { min: number; max: number } | null;
  width: number;
  spectrumHeight: number;
  waterfallHeight: number;
  format: HarnessFormat;
  aspectRatio?: CliSnapshotAspectRatio;
  geolocation?: { lat: string; lon: string } | null;
  locationLabel?: string | null;
  whole: boolean;
  modeLabel: string;
};

const VIDEO_BITRATE = 12_000_000;

const themes: Record<"dark" | "light", SnapshotTheme> = {
  dark: {
    bg: THEME_TOKENS.colors.dark.fftBackground,
    grid: THEME_TOKENS.colors.dark.fftGrid,
    line: THEME_TOKENS.colors.dark.fftLine,
    shadow: THEME_TOKENS.colors.dark.fftShadow,
    text: THEME_TOKENS.colors.dark.fftText,
    hwLine: THEME_TOKENS.colors.dark.snapHwRateLine,
    hwText: THEME_TOKENS.colors.dark.snapHwRateText,
    cfText: THEME_TOKENS.colors.dark.snapCenterLabelText,
  },
  light: {
    bg: THEME_TOKENS.colors.light.fftBackground,
    grid: THEME_TOKENS.colors.light.fftGrid,
    line: THEME_TOKENS.colors.light.fftLine,
    shadow: THEME_TOKENS.colors.light.fftShadow,
    text: THEME_TOKENS.colors.light.fftText,
    hwLine: THEME_TOKENS.colors.light.snapHwRateLine,
    hwText: THEME_TOKENS.colors.light.snapHwRateText,
    cfText: THEME_TOKENS.colors.light.snapCenterLabelText,
  },
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(svg))}`;
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${encodeBase64(
    new Uint8Array(await blob.arrayBuffer()),
  )}`;
}

function resolveVideoMimeType(format: "webm" | "mp4"): string {
  const mimeType = SNAPSHOT_VIDEO_MIME_TYPES[format].find(
    (type) =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) {
    throw new Error(
      `The headless snapshot renderer cannot record ${format.toUpperCase()} video; use --format webm, svg, or png`,
    );
  }
  return mimeType;
}

/** Records a 1s video of composed frames, mirroring the UI's canvas recorder. */
async function recordCliSnapshotVideo(
  renderFrame: () => HTMLCanvasElement,
  mimeType: string,
  durationMs = 1000,
): Promise<Blob> {
  const safeFrameRate = normalizeSnapshotVideoFrameRate();
  const firstFrame = renderFrame();
  const recordingCanvas = document.createElement("canvas");
  recordingCanvas.width = Math.max(1, firstFrame.width);
  recordingCanvas.height = Math.max(1, firstFrame.height);
  const ctx = recordingCanvas.getContext("2d");
  if (!ctx) throw new Error("Unable to initialize the video recording canvas.");

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(firstFrame, 0, 0);

  const stream = recordingCanvas.captureStream(safeFrameRate);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: VIDEO_BITRATE,
  });
  const chunks: BlobPart[] = [];

  const blob = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("Video recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.start(250);

    const frameIntervalMs = 1000 / safeFrameRate;
    let timerId = 0;
    let stopped = false;
    const tick = () => {
      const startedAt = performance.now();
      const frame = renderFrame();
      if (stopped) return;
      if (recordingCanvas.width !== frame.width)
        recordingCanvas.width = Math.max(1, frame.width);
      if (recordingCanvas.height !== frame.height)
        recordingCanvas.height = Math.max(1, frame.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
      ctx.drawImage(frame, 0, 0);
      const spent = performance.now() - startedAt;
      timerId = window.setTimeout(tick, Math.max(0, frameIntervalMs - spent));
    };
    timerId = window.setTimeout(tick, frameIntervalMs);

    window.setTimeout(() => {
      stopped = true;
      window.clearTimeout(timerId);
      try {
        recorder.stop();
      } catch (error) {
        reject(error);
      }
    }, durationMs);
  });

  return blob;
}

/** Renders Rust IQ history using the same 2D snapshot code as the app. */
async function renderNaptCliSnapshot(request: HarnessRequest): Promise<string> {
  await Promise.race([
    Promise.all([
      document.fonts.load('400 16px "JetBrains Mono"'),
      document.fonts.load('700 16px "JetBrains Mono"'),
      document.fonts.ready,
    ]),
    new Promise((resolve) => window.setTimeout(resolve, 5000)),
  ]);
  const model = buildCliSnapshotModel(
    request.iqFrames.map((iqData) => ({
      iqData: Uint8Array.from(iqData),
      centerFrequencyHz: request.centerFrequencyHz,
      sampleRateHz: request.sampleRateHz,
    })),
    {
      fftSize: request.fftSize,
      waterfall: request.waterfall,
      waterfallRows: 128,
      powerScale: request.powerScale,
      dbMin: request.dbMin,
      dbMax: request.dbMax,
    },
  );
  const data: SnapshotData = {
    waveform: model.waveform,
    fullChannelWaveform: model.waveform,
    frequencyRange: model.frequencyRange,
    dbMin: request.dbMin,
    dbMax: request.dbMax,
    powerScale: request.powerScale,
    centerFrequencyHz: request.centerFrequencyHz,
    isDeviceConnected: true,
    vizZoom: 1,
    vizPanOffset: 0,
    waterfallTextureSnapshot: null,
    waterfallTextureMeta: null,
    waterfallBuffer: model.waterfallBuffer,
    waterfallDims: model.waterfallDims,
    webgpuEnabled: false,
    hardwareSampleRateHz: request.sampleRateHz,
    colormap: WATERFALL_COLORMAPS.classic,
  };
  const fullRange = model.frequencyRange;
  const visibleRange = request.frequencyRange ?? fullRange;
  if (
    visibleRange.min < fullRange.min ||
    visibleRange.max > fullRange.max
  ) {
    throw new Error(
      `Requested frequency range ${visibleRange.min}..${visibleRange.max} Hz is outside the captured range ${fullRange.min}..${fullRange.max} Hz`,
    );
  }
  const zoom =
    (fullRange.max - fullRange.min) / (visibleRange.max - visibleRange.min);
  const panOffset =
    (visibleRange.min + visibleRange.max - fullRange.min - fullRange.max) / 2;
  const sliceWaveform = (waveform: Float32Array) =>
    getZoomedSlice(waveform, fullRange, zoom, panOffset).slicedWaveform;
  const stats = request.stats
    ? buildSnapshotStatsLines({
        range: visibleRange,
        timestampLabel: formatTimestampWithTimezone(
          new Date(request.snapshotTimestamp).toISOString(),
        ),
        deviceName: request.deviceName,
        fftSize: request.fftSize,
        fftWindow: "Rectangular",
        gain: request.gainDb,
        ppm: request.ppm,
        hardwareSampleRateHz: request.sampleRateHz,
        whole: request.whole,
        modeLabel: request.modeLabel,
        showGeolocation: Boolean(request.geolocation),
        geolocation: request.geolocation ?? null,
        locationLabel: request.locationLabel ?? null,
      })
    : [];
  const baseTheme = themes[request.theme];
  const theme: SnapshotTheme = {
    ...baseTheme,
    line: request.fftColor
      ? request.fftColor
      : request.useThemeColors
        ? THEME_TOKENS.colors[request.theme].primary
        : baseTheme.line,
  };
  const dims = resolveCliSnapshotDimensions({
    baseWidth: request.width,
    spectrumHeight: request.spectrumHeight,
    waterfallHeight: request.waterfallHeight,
    waterfall: request.waterfall,
    aspectRatio: request.aspectRatio,
  });

  const renderWaterfall = () =>
    request.waterfall
      ? (() => {
          const source = model.waterfallBuffer;
          const sourceDims = model.waterfallDims;
          if (!source || !sourceDims) return null;
          const firstColumn = Math.max(
            0,
            Math.floor(
              ((visibleRange.min - fullRange.min) /
                (fullRange.max - fullRange.min)) *
                sourceDims.width,
            ),
          );
          const lastColumn = Math.min(
            sourceDims.width,
            Math.ceil(
              ((visibleRange.max - fullRange.min) /
                (fullRange.max - fullRange.min)) *
                sourceDims.width,
            ),
          );
          const croppedWidth = Math.max(1, lastColumn - firstColumn);
          const cropped = new Uint8ClampedArray(
            croppedWidth * sourceDims.height * 4,
          );
          for (let row = 0; row < sourceDims.height; row++) {
            const sourceStart = (row * sourceDims.width + firstColumn) * 4;
            const sourceEnd = sourceStart + croppedWidth * 4;
            cropped.set(
              source.subarray(sourceStart, sourceEnd),
              row * croppedWidth * 4,
            );
          }
          return renderWaterfallSnapshotCanvas(
            {
              ...data,
              waterfallBuffer: cropped,
              waterfallDims: { width: croppedWidth, height: sourceDims.height },
            },
            dims.width,
            dims.waterfallHeight,
            {
              waterfallBg: THEME_TOKENS.colors[request.theme].waterfallBackground,
            },
          );
        })()
      : null;
  const waterfall = renderWaterfall();
  const statsRow = request.stats
    ? renderStatsRowCanvas(stats, dims.width, theme, request.aspectRatio)
    : null;
  const frameHeight = dims.height + (statsRow?.height ?? 0);

  const composeFrame = (waveform: Float32Array): HTMLCanvasElement => {
    const visibleWaveform = sliceWaveform(waveform);
    const spectrum = renderSpectrumSnapshotCanvas(
      { ...data, waveform: visibleWaveform },
      visibleRange,
      request.grid,
      dims.width,
      dims.spectrumHeight,
      fullRange,
      stats,
      visibleWaveform,
      theme,
    );
    const output = document.createElement("canvas");
    output.width = dims.width;
    output.height = frameHeight;
    const ctx = output.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(spectrum, 0, 0);
    if (waterfall) ctx.drawImage(waterfall, 0, dims.spectrumHeight);
    if (statsRow) {
      ctx.drawImage(statsRow, 0, dims.height);
    }
    return output;
  };

  const composeSvg = (waveform: Float32Array): string => {
    const visibleWaveform = sliceWaveform(waveform);
    const spectrumSvg = renderSpectrumSnapshotSvg(
      { ...data, waveform: visibleWaveform },
      visibleRange,
      request.grid,
      dims.width,
      dims.spectrumHeight,
      fullRange,
      stats,
      visibleWaveform,
      theme,
      request.aspectRatio,
    );
    // Inline the spectrum parts into the composed root instead of nesting a
    // second <svg> element: sanitization drops siblings that follow a closed
    // root element.
    const spectrumParts = extractSvgContent(spectrumSvg);
    let waterfallSection = "";
    if (waterfall) {
      const waterfallDataUrl = waterfall.toDataURL("image/png");
      waterfallSection = `<image href="${waterfallDataUrl}" x="0" y="${dims.spectrumHeight}" width="${dims.width}" height="${dims.waterfallHeight}"/>`;
    }
    let statsSection = "";
    if (statsRow) {
      const statsDataUrl = statsRow.toDataURL("image/png");
      statsSection = `<image href="${statsDataUrl}" x="0" y="${dims.height}" width="${dims.width}" height="${statsRow.height}"/>`;
    }
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.width} ${frameHeight}" width="${dims.width}" height="${frameHeight}">
  ${spectrumParts}
  ${waterfallSection}
  ${statsSection}
</svg>`;
    return generateSvgWithSymbols(svgContent);
  };

  if (request.format === "svg") {
    const svg = composeSvg(model.waveform);
    document.body.replaceChildren();
    return svgDataUrl(svg);
  }

  if (request.format === "animated-svg") {
    const frames = model.spectra.map((waveform) => composeSvg(waveform));
    const animated = createAnimatedSvgFromFrames(
      sampleFramesEvenly(frames, 12),
    );
    document.body.replaceChildren();
    return svgDataUrl(animated);
  }

  if (request.format === "webm" || request.format === "mp4") {
    const mimeType = resolveVideoMimeType(request.format);
    let frameIndex = 0;
    const blob = await recordCliSnapshotVideo(() => {
      const waveform = model.spectra[frameIndex % model.spectra.length];
      frameIndex += 1;
      return composeFrame(waveform);
    }, mimeType);
    document.body.replaceChildren();
    return blobDataUrl(blob);
  }

  const output = composeFrame(model.waveform);
  document.body.replaceChildren(output);
  return output.toDataURL("image/png");
}

Object.assign(window, { __renderNaptCliSnapshot: renderNaptCliSnapshot });

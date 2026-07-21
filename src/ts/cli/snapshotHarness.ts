import { buildCliSnapshotModel } from "./snapshotModel";
import {
  buildSnapshotStatsLines,
  renderSpectrumSnapshotCanvas,
  renderStatsRowCanvas,
  renderWaterfallSnapshotCanvas,
} from "@n-apt/hooks/useSnapshot";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import type { SnapshotData } from "@n-apt/components/FFTCanvas";
import type { SnapshotTheme } from "@n-apt/utils/rendering/SnapshotRenderer";

type HarnessRequest = {
  iqFrames: number[][];
  centerFrequencyHz: number;
  sampleRateHz: number;
  snapshotTimestamp: number;
  deviceName: string;
  gainDb: number;
  ppm: number;
  fftSize: number;
  waterfall: boolean;
  grid: boolean;
  stats: boolean;
  theme: "dark" | "light";
  width: number;
  spectrumHeight: number;
  waterfallHeight: number;
};

const themes: Record<"dark" | "light", SnapshotTheme> = {
  dark: {
    bg: "#05070d",
    grid: "rgba(0, 212, 255, 0.25)",
    line: "#00d4ff",
    shadow: "rgba(0, 212, 255, 0.22)",
    text: "#d8faff",
    hwLine: "rgba(255,255,255,0.24)",
    hwText: "rgba(255,255,255,0.68)",
    cfText: "#ffffff",
  },
  light: {
    bg: "#f7fbff",
    grid: "rgba(0, 80, 120, 0.22)",
    line: "#006d8f",
    shadow: "rgba(0, 109, 143, 0.18)",
    text: "#102a36",
    hwLine: "rgba(0,0,0,0.2)",
    hwText: "rgba(0,0,0,0.65)",
    cfText: "#000000",
  },
};

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
    },
  );
  const data: SnapshotData = {
    waveform: model.waveform,
    fullChannelWaveform: model.waveform,
    frequencyRange: model.frequencyRange,
    dbMin: -120,
    dbMax: 0,
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
  const stats = request.stats
    ? buildSnapshotStatsLines({
        range: model.frequencyRange,
        timestampLabel: new Date(request.snapshotTimestamp).toLocaleString(),
        deviceName: request.deviceName,
        channelName: "A",
        fftSize: request.fftSize,
        fftWindow: "Hanning",
        gain: request.gainDb,
        ppm: request.ppm,
        hardwareSampleRateHz: request.sampleRateHz,
        whole: true,
      })
    : [];
  const theme = themes[request.theme];
  const spectrum = renderSpectrumSnapshotCanvas(
    data,
    model.frequencyRange,
    request.grid,
    request.width,
    request.spectrumHeight,
    model.frequencyRange,
    stats,
    model.waveform,
    theme,
  );
  const waterfall = request.waterfall
    ? renderWaterfallSnapshotCanvas(
        data,
        request.width,
        request.waterfallHeight,
        {
          waterfallBg: theme.bg,
        },
      )
    : null;
  const statsRow = request.stats
    ? renderStatsRowCanvas(stats, request.width, theme)
    : null;
  const output = document.createElement("canvas");
  output.width = request.width;
  output.height =
    spectrum.height + (waterfall?.height ?? 0) + (statsRow?.height ?? 0);
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(spectrum, 0, 0);
  if (waterfall) ctx.drawImage(waterfall, 0, spectrum.height);
  if (statsRow) {
    ctx.drawImage(statsRow, 0, spectrum.height + (waterfall?.height ?? 0));
  }
  document.body.replaceChildren(output);
  return output.toDataURL("image/png");
}

Object.assign(window, { __renderNaptCliSnapshot: renderNaptCliSnapshot });

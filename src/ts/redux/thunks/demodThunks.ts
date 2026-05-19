import { createAsyncThunk } from "@reduxjs/toolkit";
import { RootState, AppDispatch } from "@n-apt/redux/store";
import type { FrequencyRange, NaptMetadata } from "@n-apt/consts/types";
import { setSpanRange, setCenterFreq, setBandwidthCenterFreq, setBandwidth, setHardwareSpanHz, setBandwidthHz, setBandwidthStartHz, setAlignment, setSourceContext } from "../slices/demodSlice";
import { setFrequencyRange, setPreviewRange, setPreviewAlignment } from "../slices/spectrumSlice";
import { sendFrequencyRange } from "./websocketThunks";

// Send get_hardware_info to server
export const fetchHardwareInfo = createAsyncThunk(
  "demod/fetchHardwareInfo",
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "get_hardware_info",
        },
      });
    }
  },
);

// Send demod_tune command to server (sets hardware center freq)
export const tuneDemod = createAsyncThunk(
  "demod/tune",
  async (range: { min_hz: number; max_hz: number }, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.websocket.isConnected) {
      dispatch({
        type: "websocket/sendMessage",
        payload: {
          type: "demod_tune",
          min_freq: range.min_hz,
          max_freq: range.max_hz,
        },
      });

      // Also update local state for the span
      dispatch(setSpanRange({ min: range.min_hz, max: range.max_hz }));

      // Default center freq to the middle of the span
      dispatch(setCenterFreq((range.min_hz + range.max_hz) / 2));
    }
  },
);

// Update internal radio center frequency
export const updateRadioCenterFreq = createAsyncThunk(
  "demod/updateRadioCenterFreq",
  async (centerMHz: number, { dispatch }) => {
    dispatch(setCenterFreq(centerMHz));
  },
);

export const syncRadioDemodFromSource = createAsyncThunk(
  "demod/syncRadioDemodFromSource",
  async (
    payload:
      | { source: "fm"; centerFreqHz: number | null; bandwidthKhz?: number | null }
      | { source: "span"; centerFreqHz: number | null; bandwidthHz: number | null }
      | { source: "apt"; centerFreqHz: number | null; bandwidthHz: number | null },
    { dispatch },
  ) => {
    if (payload.centerFreqHz != null && Number.isFinite(payload.centerFreqHz)) {
      dispatch(setCenterFreq(payload.centerFreqHz));
    }

    if (payload.source === "fm") {
      const bandwidthKhz =
        payload.bandwidthKhz != null && Number.isFinite(payload.bandwidthKhz)
          ? payload.bandwidthKhz
          : 200;
      dispatch(setBandwidth(bandwidthKhz));
      return;
    }

    if (
      payload.bandwidthHz != null &&
      Number.isFinite(payload.bandwidthHz) &&
      payload.bandwidthHz > 0
    ) {
      dispatch(setBandwidth(payload.bandwidthHz / 1000));
      dispatch(setBandwidthHz(payload.bandwidthHz));
      if (payload.centerFreqHz != null && Number.isFinite(payload.centerFreqHz)) {
        dispatch(setBandwidthStartHz(payload.centerFreqHz - payload.bandwidthHz / 2));
      }
    }
  },
);

const GLOBAL_BAND_EDGE_MIN_HZ = 0;
const GLOBAL_BAND_EDGE_MAX_HZ = 30_000_000_000;
const MIN_BANDWIDTH_HZ = 1_000;

export type Alignment = "centered" | "start" | "end";
export type DemodSourceMode = "live" | "file";
export type DemodSourceRangeReason =
  | "playback_metadata"
  | "file_metadata"
  | "selected_file_name"
  | "live_frame"
  | "live_frequency_range"
  | "live_sdr_settings";

export interface DemodSourceSyncPayload {
  sourceMode: DemodSourceMode;
  activePlaybackMetadata?: {
    activeChannel?: number;
    channelCount?: number;
    frequency_range?: [number, number];
    center_frequency_hz?: number;
    capture_sample_rate_hz?: number;
  } | null;
  loadedFileMetadata?: NaptMetadata | null;
  selectedFiles?: Array<{ name: string }> | null;
  sampleRateHz?: number | null;
  liveFrame?: {
    center_frequency_hz?: number | null;
    sample_rate?: number | null;
  } | null;
  liveFrequencyRange?: FrequencyRange | null;
  liveSdrSettings?: {
    center_frequency?: number | null;
    sample_rate?: number | null;
  } | null;
}

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const normalizeRange = (
  range: { min: number; max: number } | [number, number] | null | undefined,
): FrequencyRange | null => {
  if (!range) return null;
  const min = Array.isArray(range) ? range[0] : range.min;
  const max = Array.isArray(range) ? range[1] : range.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }
  return { min, max };
};

const rangeFromCenterAndSampleRate = (
  centerHz: unknown,
  sampleRateHz: unknown,
): FrequencyRange | null => {
  if (!isFinitePositive(centerHz) || !isFinitePositive(sampleRateHz)) {
    return null;
  }
  const half = sampleRateHz / 2;
  return { min: centerHz - half, max: centerHz + half };
};

const playbackRangeLooksBasebandAgainstMetadata = (
  playbackRange: FrequencyRange,
  metadataRange: FrequencyRange,
) => {
  return playbackRange.min < 100_000 && metadataRange.min > playbackRange.max + 1_000_000;
};

const rangesOverlap = (a: FrequencyRange, b: FrequencyRange) =>
  a.max > b.min && a.min < b.max;

const rangesEqual = (
  a: FrequencyRange | null | undefined,
  b: FrequencyRange | null | undefined,
) => {
  if (!a || !b) return a === b;
  return Math.abs(a.min - b.min) < 0.1 && Math.abs(a.max - b.max) < 0.1;
};

const rangeContains = (outer: FrequencyRange, inner: FrequencyRange) =>
  inner.min >= outer.min && inner.max <= outer.max;

const clampSelectionToRange = (
  center: number,
  bandwidth: number,
  range: FrequencyRange,
): FrequencyRange => {
  const span = range.max - range.min;
  const width = Math.max(MIN_BANDWIDTH_HZ, Math.min(bandwidth, span));
  const low = range.min;
  const high = range.max - width;
  const min = Math.max(low, Math.min(high, center - width / 2));
  return { min, max: min + width };
};

const rangeFromMetadataChannel = (
  channel: NonNullable<NaptMetadata["channels"]>[number],
): FrequencyRange | null => {
  return (
    normalizeRange(channel?.frequency_range) ??
    normalizeRange(
      channel?.requested_min_freq_hz != null &&
        channel?.requested_max_freq_hz != null
        ? [channel.requested_min_freq_hz, channel.requested_max_freq_hz]
        : null,
    ) ??
    rangeFromCenterAndSampleRate(
      channel?.center_freq_hz,
      channel?.sample_rate_hz,
    )
  );
};

const rangeFromFileMetadata = (
  metadata: NaptMetadata | null | undefined,
  activeChannel?: number,
): FrequencyRange | null => {
  if (!metadata) return null;

  const channel =
    typeof activeChannel === "number" && Array.isArray(metadata.channels)
      ? metadata.channels[activeChannel]
      : null;

  const channelRange = channel ? rangeFromMetadataChannel(channel) : null;
  const firstChannelRange = Array.isArray(metadata.channels)
    ? metadata.channels.map(rangeFromMetadataChannel).find(Boolean) ?? null
    : null;
  const topLevelRange =
    normalizeRange(metadata.frequency_range) ??
    rangeFromCenterAndSampleRate(
      metadata.center_frequency_hz ?? metadata.center_frequency,
      metadata.capture_sample_rate_hz ??
        metadata.sample_rate_hz ??
        metadata.sample_rate,
    );

  if (channelRange) {
    return channelRange;
  }

  if (
    firstChannelRange &&
    (!topLevelRange ||
      playbackRangeLooksBasebandAgainstMetadata(topLevelRange, firstChannelRange))
  ) {
    return firstChannelRange;
  }

  return (
    topLevelRange ??
    firstChannelRange
  );
};

const parseFrequencyFromSelectedFile = (
  selectedFiles: Array<{ name: string }> | null | undefined,
  sampleRateHz: number | null | undefined,
): FrequencyRange | null => {
  if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) return null;
  const sampleRate = isFinitePositive(sampleRateHz) ? sampleRateHz : 3_200_000;
  let minFreq = Infinity;
  let maxFreq = -Infinity;

  for (const file of selectedFiles) {
    const match = file.name.match(/iq_([\d._]+[a-zA-Z]*)/);
    if (!match) continue;

    const token = match[1].replace(/_/g, ".");
    const numeric = Number.parseFloat(token);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;

    const lower = token.toLowerCase();
    const freq =
      lower.includes("ghz")
        ? numeric * 1_000_000_000
        : lower.includes("khz")
          ? numeric * 1_000
          : numeric * 1_000_000;

    minFreq = Math.min(minFreq, freq - sampleRate / 2);
    maxFreq = Math.max(maxFreq, freq + sampleRate / 2);
  }

  return minFreq === Infinity ? null : { min: Math.max(0, minFreq), max: maxFreq };
};

export const resolveDemodSourceRange = (
  payload: DemodSourceSyncPayload,
): { range: FrequencyRange; reason: DemodSourceRangeReason } | null => {
  if (payload.sourceMode === "file") {
    const metadataRange = rangeFromFileMetadata(
      payload.loadedFileMetadata,
      payload.activePlaybackMetadata?.activeChannel,
    );
    const playbackRange =
      normalizeRange(payload.activePlaybackMetadata?.frequency_range) ??
      rangeFromCenterAndSampleRate(
        payload.activePlaybackMetadata?.center_frequency_hz,
        payload.activePlaybackMetadata?.capture_sample_rate_hz,
      );
    if (playbackRange) {
      if (
        metadataRange &&
        playbackRangeLooksBasebandAgainstMetadata(playbackRange, metadataRange)
      ) {
        return { range: metadataRange, reason: "file_metadata" };
      }
      return { range: playbackRange, reason: "playback_metadata" };
    }

    if (metadataRange) {
      return { range: metadataRange, reason: "file_metadata" };
    }

    const selectedFileRange = parseFrequencyFromSelectedFile(
      payload.selectedFiles,
      payload.sampleRateHz,
    );
    return selectedFileRange
      ? { range: selectedFileRange, reason: "selected_file_name" }
      : null;
  }

  const liveFrequencyRange = normalizeRange(payload.liveFrequencyRange);
  const liveFrameRange = rangeFromCenterAndSampleRate(
    payload.liveFrame?.center_frequency_hz,
    payload.liveFrame?.sample_rate,
  );
  if (liveFrameRange) {
    if (liveFrequencyRange && !rangesOverlap(liveFrameRange, liveFrequencyRange)) {
      return { range: liveFrequencyRange, reason: "live_frequency_range" };
    }
    return { range: liveFrameRange, reason: "live_frame" };
  }

  if (liveFrequencyRange) {
    return { range: liveFrequencyRange, reason: "live_frequency_range" };
  }

  const liveSdrRange = rangeFromCenterAndSampleRate(
    payload.liveSdrSettings?.center_frequency,
    payload.liveSdrSettings?.sample_rate,
  );
  return liveSdrRange ? { range: liveSdrRange, reason: "live_sdr_settings" } : null;
};

interface ConsolidatedState {
  center: number;
  bandwidth: number;
  start: number;
  span: number;
}

const dispatchSpanState = (
  dispatch: AppDispatch,
  next: ConsolidatedState,
  alignment: Alignment,
  updatePreview: boolean,
  _source?: "center" | "bandwidth" | "start" | "external" | "alignment" | "preview_sync" | "file_sync",
) => {
  dispatch(setCenterFreq(next.center));
  dispatch(setBandwidthCenterFreq(next.start + next.bandwidth / 2));
  dispatch(setBandwidthHz(next.bandwidth));
  dispatch(setBandwidth(next.bandwidth / 1000));
  dispatch(setBandwidthStartHz(next.start));
  dispatch(setHardwareSpanHz(next.span));
  dispatch(setAlignment(alignment));
  if (updatePreview) {
    dispatch(setPreviewRange({ min: next.start, max: next.start + next.bandwidth }));
    dispatch(setPreviewAlignment(alignment));
  }
};

export function getConsolidatedSpanState(
  targetCenter: number,
  targetBw: number,
  targetStart: number,
  targetSpan: number,
  mode: Alignment,
  primarySource:
    | "center"
    | "bandwidth"
    | "start"
    | "external"
    | "alignment"
    | "preview_sync"
    | "file_sync"
): ConsolidatedState {
  let c = targetCenter;
  let b = targetBw;
  let s = targetStart;
  let span = targetSpan;
  const isSelectionSource = primarySource === "preview_sync" || primarySource === "file_sync";

  const halfSpan = span / 2;
  const minC = GLOBAL_BAND_EDGE_MIN_HZ + halfSpan;
  const maxC = GLOBAL_BAND_EDGE_MAX_HZ - halfSpan;


  b = Math.max(MIN_BANDWIDTH_HZ, Math.min(b, span));

  if (!isSelectionSource && (primarySource === "center" || primarySource === "external")) {
    c = Math.max(minC, Math.min(c, maxC));
    if (mode === "centered") {
      s = c - b / 2;
    } else {
      const windowMin = c - halfSpan;
      const windowMax = c + halfSpan;
      s = Math.max(windowMin, Math.min(s, windowMax - b));
    }
  } else if (!isSelectionSource && primarySource === "bandwidth") {
    if (mode === "start") {
      const windowMin = c - halfSpan;
      const windowMax = c + halfSpan;
      s = Math.max(windowMin, Math.min(s, windowMax - b));
    } else if (mode === "end") {
      const currentEnd = targetStart + targetBw;
      s = currentEnd - b;
    } else {
      s = c - b / 2;
    }
  } else if (isSelectionSource) {
    s = targetStart;
  } else if (primarySource === "alignment") {
    const windowMin = c - halfSpan;
    const windowMax = c + halfSpan;
    s = Math.max(windowMin, Math.min(s, windowMax - b));
  } else if (primarySource === "start") {
    if (mode === "end") {
      s = targetStart - b;
    } else {
      s = targetStart;
    }
  }

  const selectionMin = s;
  const selectionMax = s + b;

  if (!isSelectionSource) {
    let windowMin = c - halfSpan;
    let windowMax = c + halfSpan;
    const buffer = span * 0.01;

    if (selectionMin < windowMin + buffer) {
      const jump = halfSpan;
      c = Math.max(minC, Math.min(c - jump, maxC));
      windowMin = c - halfSpan;
      windowMax = c + halfSpan;
    } else if (selectionMax > windowMax - buffer) {
      const jump = halfSpan;
      c = Math.max(minC, Math.min(c + jump, maxC));
      windowMin = c - halfSpan;
      windowMax = c + halfSpan;
    }

    s = Math.max(windowMin, Math.min(s, windowMax - b));
  } else {
    let windowMin = c - halfSpan;
    let windowMax = c + halfSpan;

    if (selectionMin < windowMin) {
      c = Math.max(minC, selectionMin + halfSpan);
    } else if (selectionMax > windowMax) {
      c = Math.min(maxC, selectionMax - halfSpan);
    }
  }

  return { center: c, bandwidth: b, start: s, span: span };
}

export const updateSpanStateThunk = createAsyncThunk(
  "demod/updateSpanState",
  async (
    payload: {
      params: {
        center?: number;
        bandwidth?: number;
        start?: number;
        span?: number;
        mode?: Alignment;
      };
      source:
        | "center"
        | "bandwidth"
        | "start"
        | "external"
        | "alignment"
        | "preview_sync"
        | "file_sync";
    },
    { dispatch, getState }
  ) => {
    const state = getState() as RootState;
    const demod = state.demod;
    const { params, source } = payload;

    const currentCenter = demod.centerFreqHz ?? 26_000_000;
    const currentBw = demod.bandwidthHz;
    const currentStart = demod.bandwidthStartHz;

    const currentSpan = demod.hardwareSpanHz;
    const currentMode = demod.alignment as Alignment;

    const targetCenter = params.center ?? currentCenter;
    const targetBw = params.bandwidth ?? currentBw;
    const targetStart = params.start ?? currentStart;
    const targetSpan = params.span ?? currentSpan;
    const targetMode = params.mode ?? currentMode;

    const next = getConsolidatedSpanState(
      targetCenter,
      targetBw,
      targetStart,
      targetSpan,
      targetMode,
      source
    );

    const centerMoved = Math.abs(currentCenter - next.center) > 0.1;
    const spanMoved = Math.abs(currentSpan - next.span) > 0.1;

    dispatchSpanState(
      dispatch as AppDispatch,
      next,
      targetMode,
      source !== "preview_sync" && source !== "file_sync",
      source,
    );

    if (centerMoved || spanMoved) {
      const halfSpan = next.span / 2;
      const hwRange = { min: next.center - halfSpan, max: next.center + halfSpan };

      dispatch(setFrequencyRange(hwRange));
      dispatch(sendFrequencyRange(hwRange));
    }
  }
);

export const syncDemodSpanFromSourceContext = createAsyncThunk(
  "demod/syncSpanFromSourceContext",
  async (payload: DemodSourceSyncPayload, { dispatch, getState }) => {
    const resolved = resolveDemodSourceRange(payload);
    const previousState = getState() as RootState;
    const previousSourceRange = previousState.demod.sourceRange;
    dispatch(
      setSourceContext({
        sourceMode: payload.sourceMode,
        range: resolved?.range ?? null,
        reason: resolved?.reason ?? null,
      }),
    );

    if (!resolved) return;

    const state = getState() as RootState;
    const demod = state.demod;
    const currentCenter = demod.centerFreqHz ?? 26_000_000;
    const currentBandwidth = demod.bandwidthHz;
    const currentAlignment = demod.alignment as Alignment;
    const currentPreviewRange = state.spectrum.previewRange;
    const range = resolved.range;
    const center = (range.min + range.max) / 2;
    const span = range.max - range.min;
    const sourceRangeChanged = !rangesEqual(previousSourceRange, range);
    const validPreview =
      currentPreviewRange &&
      Number.isFinite(currentPreviewRange.min) &&
      Number.isFinite(currentPreviewRange.max) &&
      currentPreviewRange.max > currentPreviewRange.min &&
      currentPreviewRange.max - currentPreviewRange.min < span &&
      rangeContains(range, currentPreviewRange)
        ? currentPreviewRange
        : null;
    const legacyBandwidthHz = demod.bandwidthKhz * 1000;
    const resetBandwidth =
      currentBandwidth > MIN_BANDWIDTH_HZ && currentBandwidth < span
        ? currentBandwidth
        : Number.isFinite(legacyBandwidthHz) &&
            legacyBandwidthHz > MIN_BANDWIDTH_HZ &&
            legacyBandwidthHz < span
          ? legacyBandwidthHz
          : Math.min(200_000, span);
    const nextSelection =
      validPreview ??
      clampSelectionToRange(
        sourceRangeChanged ? center : demod.bandwidthStartHz + resetBandwidth / 2,
        resetBandwidth,
        range,
      );
    const bandwidth = nextSelection.max - nextSelection.min;
    const start = nextSelection.min;

    if (
      Math.abs(currentCenter - center) < 0.1 &&
      Math.abs(demod.hardwareSpanHz - span) < 0.1 &&
      Math.abs(demod.bandwidthHz - bandwidth) < 0.1 &&
      Math.abs(demod.bandwidthStartHz - start) < 0.1
    ) {
      return;
    }

    const next = getConsolidatedSpanState(
      center,
      bandwidth,
      start,
      span,
      currentAlignment,
      "file_sync",
    );

    dispatchSpanState(dispatch as AppDispatch, next, currentAlignment, true, "file_sync");
  },
);

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { styled } from "styled-components";
import { Handle, Position } from "@xyflow/react";
import { Zap, BookmarkPlus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { FrequencyRange } from "@n-apt/consts/types";
import {
  requestNextPausedFrame,
  sendFrequencyRange,
} from "@n-apt/redux/thunks/websocketThunks";
import { setFrequencyRange, setPreviewRange, setPreviewAlignment } from "@n-apt/redux/slices/spectrumSlice";
import { formatFrequency } from "@n-apt/utils/frequency";
import {
  clampFrequencyHz,
  getBandwidthEndHz,
  getBandwidthStartHz,
  getCenteredFrequencyHz,
} from "@n-apt/utils/frequency";
import { FrequencyInput } from "../../ui/FrequencyInput";


const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding-bottom: 8px;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${({ theme }) => theme.colors.primary};
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  margin-bottom: 6px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const InfoValue = styled.span`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
`;

const InputGroup = styled.div`
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const InputField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 9px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const ApplyButton = styled.button`
  margin-top: 12px;
  width: 100%;
  background: ${({ theme }) => theme.colors.primary}22;
  border: 1px solid ${({ theme }) => theme.colors.primary}44;
  color: ${({ theme }) => theme.colors.primary};
  padding: 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}44;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const PresetSection = styled.div`
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const PresetSaveRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: stretch;
  margin-bottom: 8px;
`;

const PresetNameInput = styled.input`
  flex: 1;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 4px 6px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.mono};

  &::placeholder {
    color: ${({ theme }) => theme.colors.textMuted};
  }

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const SmallButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid ${({ theme }) => theme.colors.primary}44;
  background: ${({ theme }) => theme.colors.primary}18;
  color: ${({ theme }) => theme.colors.primary};
  white-space: nowrap;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}33;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const PresetList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow-y: auto;
`;

const PresetItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
`;

const PresetLoadBtn = styled.button`
  flex: 1;
  text-align: left;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 10px;
  font-family: ${({ theme }) => theme.typography.mono};
  cursor: pointer;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const IconGhostBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textMuted};
  cursor: pointer;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
    background: ${({ theme }) => theme.colors.primary}15;
  }
`;

interface SpanNodeProps {
  data: {
    label: string;
  };
}

/** Hard limits for the observable band edges (selection must fit). */
const GLOBAL_BAND_EDGE_MIN_HZ = 0;
const GLOBAL_BAND_EDGE_MAX_HZ = 30_000_000_000;
const HARDWARE_MIN_CENTER_HZ = 0;
const HARDWARE_MAX_CENTER_HZ = 30_000_000_000;

/** Minimum selection bandwidth. */
const MIN_BANDWIDTH_HZ = 1_000;

export const SPAN_PRESETS_STORAGE_KEY = "n-apt.span-presets.v1";

export const AlignmentSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 10px;
  padding: 6px;
  width: 100%;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  
  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

type Alignment = "centered" | "start" | "end";

interface SpanPreset {
  id: string;
  name: string;
  centerFreqHz: number;
  bandwidthHz: number;
  bandwidthStartHz: number;
  hardwareSpanHz?: number;
}

function maxBandwidthForCenter(centerHz: number, sampleRateHz: number): number {
  if (!Number.isFinite(centerHz) || !Number.isFinite(sampleRateHz)) {
    return MIN_BANDWIDTH_HZ;
  }
  const byLowEdge = 2 * (centerHz - GLOBAL_BAND_EDGE_MIN_HZ);
  const byHighEdge = 2 * (GLOBAL_BAND_EDGE_MAX_HZ - centerHz);
  const raw = Math.min(sampleRateHz, byLowEdge, byHighEdge);
  return Math.max(MIN_BANDWIDTH_HZ, raw);
}

/** Keeps selection [start, start+bw] inside capture [center−span/2, center+span/2] and global band. */
export function clampBandwidthStartHz(params: {
  centerHz: number;
  bandwidthHz: number;
  captureSpanHz: number;
  startHz: number;
}): number {
  const { centerHz, bandwidthHz, captureSpanHz, startHz } = params;
  if (
    !Number.isFinite(centerHz) ||
    !Number.isFinite(bandwidthHz) ||
    !Number.isFinite(captureSpanHz) ||
    bandwidthHz < MIN_BANDWIDTH_HZ
  ) {
    return GLOBAL_BAND_EDGE_MIN_HZ;
  }
  const half = captureSpanHz / 2;
  const capLo = Math.max(GLOBAL_BAND_EDGE_MIN_HZ, centerHz - half);
  const capHi = Math.min(GLOBAL_BAND_EDGE_MAX_HZ, centerHz + half);
  const lo = capLo;
  const hi = Math.max(lo, capHi - bandwidthHz);
  return clampFrequencyHz(startHz, lo, hi);
}

function loadPresetsFromStorage(): SpanPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SPAN_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is SpanPreset =>
        p &&
        typeof p === "object" &&
        typeof (p as SpanPreset).name === "string" &&
        typeof (p as SpanPreset).id === "string" &&
        Number.isFinite((p as SpanPreset).centerFreqHz) &&
        Number.isFinite((p as SpanPreset).bandwidthHz) &&
        Number.isFinite((p as SpanPreset).bandwidthStartHz),
    );
  } catch {
    return [];
  }
}

function persistPresets(list: SpanPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPAN_PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

function newPresetId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const SpanNode: React.FC<SpanNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const hardwareRange = useAppSelector((state) => state.demod.hardwareRange);
  const sampleRateHz = useAppSelector((state) => state.demod.sampleRateHz);
  const activeFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const previewRange = useAppSelector((state) => state.spectrum.previewRange);
  const isPaused = useAppSelector((state) => state.websocket.isPaused);
  const isConnected = useAppSelector((state) => state.websocket.isConnected);

  const [centerFreqHz, setCenterFreqHz] = useState(26_000_000);
  const [hardwareSpanHz, setHardwareSpanHz] = useState(3_200_000);
  const [bandwidthHz, setBandwidthHz] = useState(500_000);
  const [bandwidthStartHz, setBandwidthStartHz] = useState(
    getCenteredFrequencyHz(26_000_000, 500_000),
  );
  const [alignment, setAlignment] = useState<Alignment>("centered");

  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presets, setPresets] = useState<SpanPreset[]>(loadPresetsFromStorage);
  const lastDispatchedRangeRef = useRef<FrequencyRange | null>(null);
  const isPublishingLocalRangeRef = useRef(false);
  const pausedFrameRequestTimeoutRef = useRef<number | null>(null);

  const maybeRequestPausedFrame = useCallback(
    (direction: "left" | "right" | "none" = "none") => {
      if (!isPaused || !isConnected) return;
      if (pausedFrameRequestTimeoutRef.current !== null) {
        window.clearTimeout(pausedFrameRequestTimeoutRef.current);
      }
      pausedFrameRequestTimeoutRef.current = window.setTimeout(() => {
        const selectionRange = lastDispatchedRangeRef.current;
        if (!selectionRange || !activeFrequencyRange) {
          pausedFrameRequestTimeoutRef.current = null;
          return;
        }

        const atLeftEdge =
          selectionRange.min <= activeFrequencyRange.min + 0.1;
        const atRightEdge =
          selectionRange.max >= activeFrequencyRange.max - 0.1;

        const shouldRequest =
          (direction === "right" && atRightEdge) ||
          (direction === "left" &&
            atLeftEdge &&
            activeFrequencyRange.min > 0);

        if (!shouldRequest) {
          pausedFrameRequestTimeoutRef.current = null;
          return;
        }

        dispatch(requestNextPausedFrame());
        pausedFrameRequestTimeoutRef.current = null;
      }, 0);
    },
    [activeFrequencyRange, dispatch, isConnected, isPaused],
  );

  const displaySampleRateHz =
    sampleRateHz && sampleRateHz > 0 ? sampleRateHz : 3_200_000;

  const derivedSpanHz = useMemo(() => {
    if (Number.isFinite(hardwareSpanHz) && hardwareSpanHz > 0) {
      return hardwareSpanHz;
    }
    if (Number.isFinite(displaySampleRateHz) && displaySampleRateHz > 0) {
      return displaySampleRateHz;
    }
    if (activeFrequencyRange) {
      const range = activeFrequencyRange.max - activeFrequencyRange.min;
      if (range > 0) return range;
    }
    return 3_200_000;
  }, [activeFrequencyRange, displaySampleRateHz, hardwareSpanHz]);

  const { minCenterHz, maxCenterHz } = useMemo(() => {
    const halfCapture = derivedSpanHz / 2;
    if (!Number.isFinite(derivedSpanHz) || derivedSpanHz <= 0) {
      return {
        minCenterHz: HARDWARE_MIN_CENTER_HZ,
        maxCenterHz: HARDWARE_MAX_CENTER_HZ,
      };
    }
    const minFromLow = GLOBAL_BAND_EDGE_MIN_HZ + halfCapture;
    const maxFromHigh = GLOBAL_BAND_EDGE_MAX_HZ - halfCapture;

    const actualMin = Math.max(minFromLow, HARDWARE_MIN_CENTER_HZ);
    const actualMax = Math.min(maxFromHigh, HARDWARE_MAX_CENTER_HZ);

    if (actualMax >= actualMin) {
      return { minCenterHz: actualMin, maxCenterHz: actualMax };
    }
    return { minCenterHz: actualMin, maxCenterHz: actualMin };
  }, [derivedSpanHz]);

  const maxBandwidthHz = derivedSpanHz;

  const { bandwidthStartMinHz, bandwidthStartMaxHz } = useMemo(() => {
    const lo = GLOBAL_BAND_EDGE_MIN_HZ;
    const hi = Math.max(lo, GLOBAL_BAND_EDGE_MAX_HZ - bandwidthHz);
    return {
      bandwidthStartMinHz: lo,
      bandwidthStartMaxHz: hi,
    };
  }, [bandwidthHz]);

  const prevDerivedSpanRef = useRef<number | null>(null);
  const hasSyncedInitialValue = useRef(false);
  const lastUserActionTimeRef = useRef<number>(0);

  const getConsolidatedState = useCallback((
    targetCenter: number,
    targetBw: number,
    targetStart: number,
    targetSpan: number,
    mode: Alignment,
    primarySource: 'center' | 'bandwidth' | 'start' | 'external' | 'alignment' | 'preview_sync'
  ) => {
    let c = targetCenter;
    let b = targetBw;
    let s = targetStart;
    let span = targetSpan;

    const halfSpan = span / 2;
    const minC = Math.max(HARDWARE_MIN_CENTER_HZ, GLOBAL_BAND_EDGE_MIN_HZ + halfSpan);
    const maxC = Math.min(HARDWARE_MAX_CENTER_HZ, GLOBAL_BAND_EDGE_MAX_HZ - halfSpan);

    b = Math.max(MIN_BANDWIDTH_HZ, Math.min(b, span));

    if (primarySource === 'center' || primarySource === 'external') {
      c = Math.max(minC, Math.min(c, maxC));
      if (mode === 'centered') {
        s = c - b / 2;
      } else if (mode === 'start') {
        s = Math.max(GLOBAL_BAND_EDGE_MIN_HZ, Math.min(s, GLOBAL_BAND_EDGE_MAX_HZ - b));
      } else if (mode === 'end') {
        s = Math.max(GLOBAL_BAND_EDGE_MIN_HZ, Math.min(s, GLOBAL_BAND_EDGE_MAX_HZ - b));
      }
    } else if (primarySource === 'bandwidth') {
      if (mode === 'start') {
      } else if (mode === 'end') {
        const currentEnd = targetStart + targetBw;
        s = currentEnd - b;
      } else {
        s = c - b / 2;
      }
    } else if (primarySource === 'preview_sync') {
      s = targetStart;
    } else if (primarySource === 'alignment') {
      s = Math.max(GLOBAL_BAND_EDGE_MIN_HZ, Math.min(s, GLOBAL_BAND_EDGE_MAX_HZ - b));
    } else if (primarySource === 'start') {
      if (mode === 'end') {
        s = targetStart - b;
      } else {
        s = targetStart;
      }
    }

    const selectionMin = s;
    const selectionMax = s + b;

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

    return { center: c, bandwidth: b, start: s, span: span };
  }, []);

  const updateState = useCallback((
    c: number, 
    b: number, 
    s: number, 
    span: number,
    mode: Alignment, 
    source: 'center' | 'bandwidth' | 'start' | 'external' | 'alignment' | 'preview_sync'
  ) => {
    const next = getConsolidatedState(c, b, s, span, mode, source);
    
    const centerMoved = Math.abs(centerFreqHz - next.center) > 0.1;
    const spanMoved = Math.abs(hardwareSpanHz - next.span) > 0.1;

    setCenterFreqHz(prev => Math.abs(prev - next.center) < 0.01 ? prev : next.center);
    setBandwidthHz(prev => Math.abs(prev - next.bandwidth) < 0.01 ? prev : next.bandwidth);
    setBandwidthStartHz(prev => Math.abs(prev - next.start) < 0.01 ? prev : next.start);
    setHardwareSpanHz(prev => Math.abs(prev - next.span) < 0.01 ? prev : next.span);

    if (source !== 'preview_sync') {
      const selectionRange = { min: next.start, max: next.start + next.bandwidth };
      const isDifferent = !lastDispatchedRangeRef.current ||
        Math.abs(selectionRange.min - lastDispatchedRangeRef.current.min) > 0.1 ||
        Math.abs(selectionRange.max - lastDispatchedRangeRef.current.max) > 0.1;
        
      if (isDifferent) {
        lastDispatchedRangeRef.current = selectionRange;
        dispatch(setPreviewRange(selectionRange));
        if (activeFrequencyRange) {
          if (selectionRange.max > activeFrequencyRange.max) {
            maybeRequestPausedFrame("right");
          } else if (selectionRange.min < activeFrequencyRange.min) {
            maybeRequestPausedFrame("left");
          }
        }
      }
      dispatch(setPreviewAlignment(mode));
    }

    if (centerMoved || spanMoved) {
      const halfSpan = next.span / 2;
      const hwRange = { min: next.center - halfSpan, max: next.center + halfSpan };
      
      isPublishingLocalRangeRef.current = true;
      dispatch(setFrequencyRange(hwRange));
      dispatch(sendFrequencyRange(hwRange));
      setTimeout(() => {
        isPublishingLocalRangeRef.current = false;
      }, 0);
    }
  }, [getConsolidatedState, dispatch, centerFreqHz, hardwareSpanHz]);

  const isRecentlyInteracted = Date.now() - lastUserActionTimeRef.current < 1500;

  useEffect(() => {
    if (!activeFrequencyRange) return;
    if (!hasSyncedInitialValue.current) return;

    const hwCenter = (activeFrequencyRange.min + activeFrequencyRange.max) / 2;
    const hwSpan = activeFrequencyRange.max - activeFrequencyRange.min;

    if (!isRecentlyInteracted && Math.abs(hwCenter - centerFreqHz) > 1000) {
      updateState(hwCenter, bandwidthHz, bandwidthStartHz, hwSpan, alignment, 'external');
    }
  }, [activeFrequencyRange, hardwareSpanHz, alignment, updateState, centerFreqHz, isRecentlyInteracted, bandwidthHz, bandwidthStartHz]);

  useEffect(() => {
    if (hasSyncedInitialValue.current) return;
    if (!Number.isFinite(centerFreqHz) || !Number.isFinite(bandwidthHz)) return;
    hasSyncedInitialValue.current = true;
    updateState(centerFreqHz, bandwidthHz, bandwidthStartHz, derivedSpanHz, alignment, "external");
  }, [centerFreqHz, bandwidthHz, bandwidthStartHz, derivedSpanHz, alignment, updateState]);

  useEffect(() => {
    if (!previewRange || isRecentlyInteracted || isPublishingLocalRangeRef.current) return;
    
    const center = (previewRange.min + previewRange.max) / 2;
    const bw = previewRange.max - previewRange.min;
    
    updateState(centerFreqHz, bw, previewRange.min, hardwareSpanHz, alignment, 'preview_sync');
  }, [previewRange, updateState, centerFreqHz, hardwareSpanHz, alignment, isRecentlyInteracted]);

  const handleBandwidthStartChange = (val: number) => {
    lastUserActionTimeRef.current = Date.now();
    const direction =
      val > bandwidthStartHz ? "right" : val < bandwidthStartHz ? "left" : "none";
    updateState(centerFreqHz, bandwidthHz, val, hardwareSpanHz, alignment, 'start');
    if (direction !== "none") {
      maybeRequestPausedFrame(direction);
    }
  };

  const handleCenterFreqChange = (val: number) => {
    lastUserActionTimeRef.current = Date.now();
    updateState(val, bandwidthHz, bandwidthStartHz, hardwareSpanHz, alignment, 'center');
  };

  const handleHardwareSpanChange = (val: number) => {
    lastUserActionTimeRef.current = Date.now();
    updateState(centerFreqHz, bandwidthHz, bandwidthStartHz, val, alignment, 'external');
  };

  const handleBandwidthChange = (val: number) => {
    lastUserActionTimeRef.current = Date.now();
    updateState(centerFreqHz, val, bandwidthStartHz, hardwareSpanHz, alignment, 'bandwidth');
  };

  useEffect(() => {
    return () => {
      dispatch(setPreviewRange(null));
    };
  }, [dispatch]);

  const displayHardwareRange = hardwareRange ?? { min: 0, max: 2_000_000_000 };

  const selectionMinHz = bandwidthStartHz;
  const selectionMaxHz = bandwidthStartHz + bandwidthHz;
  const selectionCenterHz = bandwidthStartHz + bandwidthHz / 2;
  const bandwidthStartStepHz =
    alignment === "centered" ? bandwidthHz / 2 : bandwidthHz;

  const handleApply = () => {
    const halfSpan = hardwareSpanHz / 2;
    const range = { 
      min: centerFreqHz - halfSpan, 
      max: centerFreqHz + halfSpan 
    };
    dispatch(setFrequencyRange(range));
    dispatch(sendFrequencyRange(range));
  };


  const handleSavePreset = useCallback(() => {
    const name = presetNameDraft.trim();
    if (!name) return;
    const entry: SpanPreset = {
      id: newPresetId(),
      name,
      centerFreqHz,
      bandwidthHz,
      bandwidthStartHz,
      hardwareSpanHz,
    };
    setPresets((prev) => {
      const withoutDupName = prev.filter((p) => p.name !== name);
      const next = [...withoutDupName, entry];
      persistPresets(next);
      return next;
    });
    setPresetNameDraft("");
  }, [presetNameDraft, centerFreqHz, bandwidthHz, bandwidthStartHz, hardwareSpanHz]);

  const handleLoadPreset = useCallback((p: SpanPreset) => {
    lastUserActionTimeRef.current = Date.now();
    updateState(p.centerFreqHz, p.bandwidthHz, p.bandwidthStartHz, p.hardwareSpanHz ?? 3_200_000, alignment, "external");
  }, [alignment, updateState]);

  const handleDeletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      const next = prev.filter((x) => x.id !== id);
      persistPresets(next);
      return next;
    });
  }, []);

  return (
    <>
      <Header>
        <Zap size={14} color="#00d4ff" fill="#00d4ff" />
        <Title>{data.label || "Span"}</Title>
      </Header>

      <InputGroup>
        <InputField>
          <Label htmlFor="hw-span">Sample Rate</Label>
          <FrequencyInput
            id="hw-span"
            valueHz={hardwareSpanHz}
            onChangeHz={handleHardwareSpanChange}
            minHz={MIN_BANDWIDTH_HZ}
            maxHz={10_000_000}
          />
        </InputField>
        <InputField>
          <Label htmlFor="hw-center">Center Frequency</Label>
          <FrequencyInput
            id="hw-center"
            valueHz={centerFreqHz}
            onChangeHz={handleCenterFreqChange}
            minHz={minCenterHz}
            maxHz={maxCenterHz}
          />
        </InputField>
        <InputField>
          <Label htmlFor="sel-start">Bandwidth Start</Label>
          <FrequencyInput
            id="sel-start"
            valueHz={bandwidthStartHz}
            onChangeHz={handleBandwidthStartChange}
            minHz={bandwidthStartMinHz}
            maxHz={bandwidthStartMaxHz}
            stepHz={bandwidthStartStepHz}
          />
        </InputField>
        <InputField>
          <Label htmlFor="sel-width">Bandwidth</Label>
          <FrequencyInput
            id="sel-width"
            valueHz={bandwidthHz}
            onChangeHz={handleBandwidthChange}
            minHz={MIN_BANDWIDTH_HZ}
            maxHz={maxBandwidthHz}
          />
        </InputField>
        <InputField>
          <Label htmlFor="bw-alignment">Bandwidth Alignment</Label>
          <AlignmentSelect 
            id="bw-alignment"
            value={alignment} 
            onChange={(e) => {
              const newMode = e.target.value as Alignment;
              setAlignment(newMode);
              dispatch(setPreviewAlignment(newMode));
              updateState(centerFreqHz, bandwidthHz, bandwidthStartHz, hardwareSpanHz, newMode, 'alignment');
            }}
          >
            <option value="centered">Centered</option>
            <option value="start">Start</option>
            <option value="end">End</option>
          </AlignmentSelect>
        </InputField>
      </InputGroup>

      <PresetSection>
        <Label style={{ marginBottom: "6px", display: "block" }}>
          Saved areas
        </Label>
        <PresetSaveRow>
          <PresetNameInput
            placeholder="Preset name…"
            value={presetNameDraft}
            onChange={(e) => setPresetNameDraft(e.target.value)}
            aria-label="Preset name"
          />
          <SmallButton
            type="button"
            onClick={handleSavePreset}
            disabled={!presetNameDraft.trim()}
            aria-label="Save preset"
          >
            <BookmarkPlus size={12} />
            Save
          </SmallButton>
        </PresetSaveRow>
        <PresetList>
          {presets.length === 0 ? (
            <span style={{ fontSize: "10px", color: "inherit", opacity: 0.6 }}>
              No saved presets yet.
            </span>
          ) : (
            presets.map((p) => (
              <PresetItem key={p.id}>
                <PresetLoadBtn
                  type="button"
                  onClick={() => handleLoadPreset(p)}
                  aria-label={`Load preset ${p.name}`}
                >
                  {p.name}
                </PresetLoadBtn>
                <IconGhostBtn
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  onClick={() => handleDeletePreset(p.id)}
                >
                  <Trash2 size={14} />
                </IconGhostBtn>
              </PresetItem>
            ))
          )}
        </PresetList>
      </PresetSection>

      <ApplyButton onClick={handleApply}>Apply Span</ApplyButton>

    </>
  );
};

export default SpanNode;

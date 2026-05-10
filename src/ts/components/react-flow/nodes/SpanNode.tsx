import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import styled from "styled-components";
import { Handle, Position } from "@xyflow/react";
import { Zap, BookmarkPlus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { FrequencyRange } from "@n-apt/consts/types";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import { setFrequencyRange, setPreviewRange, setPreviewCenterHz } from "@n-apt/redux/slices/spectrumSlice";
import { formatFrequency } from "@n-apt/utils/frequency";
import { FrequencyInput } from "../../ui/FrequencyInput";

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 12px;
  min-width: 320px;
  color: ${({ theme }) => theme.colors.textPrimary};
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
`;

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
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 6px 8px;
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
const HARDWARE_MIN_CENTER_HZ = 1_600_000;
const HARDWARE_MAX_CENTER_HZ = 30_000_000_000;

/** Minimum selection bandwidth. */
const MIN_BANDWIDTH_HZ = 1_000;

export const SPAN_PRESETS_STORAGE_KEY = "n-apt.span-presets.v1";

export interface SpanPreset {
  id: string;
  name: string;
  centerFreqHz: number;
  bandwidthHz: number;
  bandwidthStartHz: number;
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
  const hi = capHi - bandwidthHz;
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(startHz, hi));
}

function centeredBandwidthStart(centerHz: number, bandwidthHz: number): number {
  return centerHz - bandwidthHz / 2;
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

  const [centerFreqHz, setCenterFreqHz] = useState(137_500_000);
  const [bandwidthHz, setBandwidthHz] = useState(3_200_000);
  const [bandwidthStartHz, setBandwidthStartHz] = useState(
    centeredBandwidthStart(137_500_000, 3_200_000),
  );

  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presets, setPresets] = useState<SpanPreset[]>(loadPresetsFromStorage);

  const displaySampleRateHz =
    sampleRateHz && sampleRateHz > 0 ? sampleRateHz : 3_200_000;

  const derivedSpanHz = useMemo(() => {
    // Priority 1: Use the active visual range from the spectrum if available
    if (activeFrequencyRange) {
      const range = activeFrequencyRange.max - activeFrequencyRange.min;
      if (range > 0) return range;
    }
    // Priority 2: Use the sample rate from the demod settings
    if (Number.isFinite(displaySampleRateHz) && displaySampleRateHz > 0) {
      return displaySampleRateHz;
    }
    return 3_200_000;
  }, [activeFrequencyRange, displaySampleRateHz]);

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

    // Center frequency must be at least HARDWARE_MIN_CENTER_HZ
    // AND it must be far enough from GLOBAL_BAND_EDGE_MIN_HZ to fit half the span.
    const actualMin = Math.max(minFromLow, HARDWARE_MIN_CENTER_HZ);
    const actualMax = Math.min(maxFromHigh, HARDWARE_MAX_CENTER_HZ);

    if (actualMax >= actualMin) {
      return { minCenterHz: actualMin, maxCenterHz: actualMax };
    }
    return { minCenterHz: actualMin, maxCenterHz: actualMin };
  }, [derivedSpanHz]);

  const maxBandwidthHz = derivedSpanHz;

  const { bandwidthStartMinHz, bandwidthStartMaxHz } = useMemo(() => {
    // Relaxed boundaries for bandwidth start to allow "pushing" the window.
    // The actual clamping is handled in handleBandwidthStartChange.
    const lo = GLOBAL_BAND_EDGE_MIN_HZ;
    const hi = Math.max(lo, GLOBAL_BAND_EDGE_MAX_HZ - bandwidthHz);
    return {
      bandwidthStartMinHz: lo,
      bandwidthStartMaxHz: hi,
    };
  }, [bandwidthHz]);

  const handleBandwidthStartChange = useCallback(
    (newStart: number) => {
      setCenterFreqHz(oldCenter => {
        const half = derivedSpanHz / 2;
        const lo = oldCenter - half;
        const hi = oldCenter + half;
        const newEnd = newStart + bandwidthHz;

        let nextCenter = oldCenter;
        if (newStart < lo) {
          nextCenter = oldCenter - (lo - newStart);
        } else if (newEnd > hi) {
          nextCenter = oldCenter + (newEnd - hi);
        }
        
        return Math.max(minCenterHz, Math.min(nextCenter, maxCenterHz));
      });
      setBandwidthStartHz(newStart);
    },
    [bandwidthHz, derivedSpanHz, minCenterHz, maxCenterHz],
  );

  const handleCenterFreqChange = useCallback((val: number) => {
    setCenterFreqHz(val);
  }, []);

  const handleBandwidthChange = useCallback(
    (newBw: number) => {
      setCenterFreqHz(oldCenter => {
        const half = derivedSpanHz / 2;
        const currentHi = oldCenter + half;
        const newEnd = bandwidthStartHz + newBw;

        let nextCenter = oldCenter;
        if (newEnd > currentHi) {
          nextCenter = oldCenter + (newEnd - currentHi);
        }
        
        return Math.max(minCenterHz, Math.min(nextCenter, maxCenterHz));
      });
      setBandwidthHz(newBw);
    },
    [bandwidthStartHz, derivedSpanHz, minCenterHz, maxCenterHz],
  );

  const prevDerivedSpanRef = useRef<number | null>(null);

  const hasSyncedInitialValue = useRef(false);
  useEffect(() => {
    if (!activeFrequencyRange) return;
    if (hasSyncedInitialValue.current) return;

    const { min, max } = activeFrequencyRange;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    let center = (min + max) / 2;
    let bw = Math.max(MIN_BANDWIDTH_HZ, max - min);
    center = Math.max(minCenterHz, Math.min(center, maxCenterHz));
    bw = Math.min(bw, maxBandwidthForCenter(center, derivedSpanHz));
    bw = Math.max(MIN_BANDWIDTH_HZ, bw);

    let start = min;
    start = clampBandwidthStartHz({
      centerHz: center,
      bandwidthHz: bw,
      captureSpanHz: derivedSpanHz,
      startHz: start,
    });

    setCenterFreqHz(center);
    setBandwidthHz(bw);
    setBandwidthStartHz(start);
    hasSyncedInitialValue.current = true;
  }, [activeFrequencyRange, derivedSpanHz, minCenterHz, maxCenterHz]);

  useEffect(() => {
    if (prevDerivedSpanRef.current === null) {
      prevDerivedSpanRef.current = derivedSpanHz;
      return;
    }
    if (prevDerivedSpanRef.current === derivedSpanHz) return;
    prevDerivedSpanRef.current = derivedSpanHz;

    setBandwidthHz((bw) => Math.min(bw, derivedSpanHz));
  }, [derivedSpanHz]);

  useEffect(() => {
    if (centerFreqHz < minCenterHz) {
      setCenterFreqHz(minCenterHz);
    } else if (centerFreqHz > maxCenterHz) {
      setCenterFreqHz(maxCenterHz);
    }
  }, [centerFreqHz, minCenterHz, maxCenterHz]);

  useEffect(() => {
    const cap = maxBandwidthForCenter(centerFreqHz, derivedSpanHz);
    if (bandwidthHz > cap) {
      setBandwidthHz(Math.max(MIN_BANDWIDTH_HZ, cap));
    } else if (bandwidthHz < MIN_BANDWIDTH_HZ) {
      setBandwidthHz(MIN_BANDWIDTH_HZ);
    }
  }, [centerFreqHz, derivedSpanHz, bandwidthHz]);

  useEffect(() => {
    setBandwidthStartHz((start) =>
      clampBandwidthStartHz({
        centerHz: centerFreqHz,
        bandwidthHz,
        captureSpanHz: derivedSpanHz,
        startHz: start,
      }),
    );
  }, [centerFreqHz, bandwidthHz, derivedSpanHz]);

  // Sync local state to global preview state for live visualization
  useEffect(() => {
    const range = {
      min: bandwidthStartHz,
      max: bandwidthStartHz + bandwidthHz,
    };
    dispatch(setPreviewRange(range));
    dispatch(setPreviewCenterHz(centerFreqHz));

    // Clear preview on unmount
    return () => {
      dispatch(setPreviewRange(null));
      dispatch(setPreviewCenterHz(null));
    };
  }, [dispatch, bandwidthStartHz, bandwidthHz, centerFreqHz]);

  // Sync preview to Redux for FFTNode live preview
  useEffect(() => {
    const half = derivedSpanHz / 2;
    dispatch(
      setPreviewRange({
        min: bandwidthStartHz,
        max: bandwidthStartHz + bandwidthHz,
      } as FrequencyRange),
    );

    return () => {
      dispatch(setPreviewRange(null));
    };
  }, [bandwidthStartHz, bandwidthHz, centerFreqHz, derivedSpanHz, dispatch]);

  const displayHardwareRange = hardwareRange ?? { min: 0, max: 2_000_000_000 };

  const selectionMinHz = bandwidthStartHz;
  const selectionMaxHz = bandwidthStartHz + bandwidthHz;
  const selectionCenterHz = bandwidthStartHz + bandwidthHz / 2;

  const handleApply = () => {
    if (
      Number.isFinite(centerFreqHz) &&
      Number.isFinite(bandwidthHz) &&
      Number.isFinite(bandwidthStartHz) &&
      bandwidthHz >= MIN_BANDWIDTH_HZ &&
      selectionMaxHz > selectionMinHz
    ) {
      const range = { min: selectionMinHz, max: selectionMaxHz };
      dispatch(setFrequencyRange(range));
      dispatch(sendFrequencyRange(range));
    }
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
    };
    setPresets((prev) => {
      const withoutDupName = prev.filter((p) => p.name !== name);
      const next = [...withoutDupName, entry];
      persistPresets(next);
      return next;
    });
    setPresetNameDraft("");
  }, [presetNameDraft, centerFreqHz, bandwidthHz, bandwidthStartHz]);

  const handleLoadPreset = useCallback((p: SpanPreset) => {
    setCenterFreqHz(p.centerFreqHz);
    setBandwidthHz(p.bandwidthHz);
    setBandwidthStartHz(p.bandwidthStartHz);
  }, []);

  const handleDeletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      const next = prev.filter((x) => x.id !== id);
      persistPresets(next);
      return next;
    });
  }, []);

  return (
    <NodeContainer>
      <Header>
        <Zap size={14} color="#00d4ff" fill="#00d4ff" />
        <Title>{data.label || "Span"}</Title>
      </Header>

      <InfoRow>
        <span>Hardware Frequency Range:</span>
        <InfoValue>
          {`${formatFrequency(displayHardwareRange.min)} - ${formatFrequency(displayHardwareRange.max)}`}
        </InfoValue>
      </InfoRow>
      <InfoRow>
        <span>Sample Rate (max bandwidth):</span>
        <InfoValue>{formatFrequency(displaySampleRateHz)}</InfoValue>
      </InfoRow>
      <InfoRow>
        <span>Selection start:</span>
        <InfoValue>
          {formatFrequency(selectionMinHz, {
            precisionMHz: 3,
            precisionGHz: 3,
          })}
        </InfoValue>
      </InfoRow>
      <InfoRow>
        <span>Selection end:</span>
        <InfoValue>
          {formatFrequency(selectionMaxHz, {
            precisionMHz: 3,
            precisionGHz: 3,
          })}
        </InfoValue>
      </InfoRow>
      <InfoRow>
        <span>Selection center (derived):</span>
        <InfoValue>
          {formatFrequency(selectionCenterHz, {
            precisionMHz: 3,
            precisionGHz: 3,
          })}
        </InfoValue>
      </InfoRow>

      <InputGroup>
        <InputField>
          <Label>Center Frequency</Label>
          <FrequencyInput
            valueHz={centerFreqHz}
            onChangeHz={handleCenterFreqChange}
            minHz={minCenterHz}
            maxHz={maxCenterHz}
          />
        </InputField>
        <InputField>
          <Label>Bandwidth</Label>
          <FrequencyInput
            valueHz={bandwidthHz}
            onChangeHz={handleBandwidthChange}
            minHz={MIN_BANDWIDTH_HZ}
            maxHz={maxBandwidthHz}
          />
        </InputField>
        <InputField>
          <Label>Bandwidth start</Label>
          <FrequencyInput
            valueHz={bandwidthStartHz}
            onChangeHz={handleBandwidthStartChange}
            minHz={bandwidthStartMinHz}
            maxHz={bandwidthStartMaxHz}
          />
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

      <Handle type="target" position={Position.Left} id="range" />
      <Handle type="source" position={Position.Right} id="range" />
    </NodeContainer>
  );
};

export default SpanNode;

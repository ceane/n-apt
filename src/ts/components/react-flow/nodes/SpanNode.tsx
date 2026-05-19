import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { styled } from "styled-components";
import { Zap, BookmarkPlus, Trash2, Loader2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import { updateSpanStateThunk } from "@n-apt/redux/thunks/demodThunks";
import { setFrequencyRange, setPreviewRange } from "@n-apt/redux/slices/spectrumSlice";
import { clampFrequencyHz } from "@n-apt/utils/frequency";
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
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SyncingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textMuted};
  animation: fadeIn 0.3s ease-out;

  @keyframes fadeIn {
    from { opacity: 0; transform: translateX(-4px); }
    to { opacity: 1; transform: translateX(0); }
  }
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
  const sampleRateHz = useAppSelector((state) => state.demod.sampleRateHz);
  const activeFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const previewRange = useAppSelector((state) => state.spectrum.previewRange);
  const centerFreqHz = useAppSelector((state) => state.demod.centerFreqHz) ?? 26_000_000;
  const hardwareSpanHz = useAppSelector((state) => state.demod.hardwareSpanHz);
  const bandwidthHz = useAppSelector((state) => state.demod.bandwidthHz);
  const bandwidthStartHz = useAppSelector((state) => state.demod.bandwidthStartHz);
  const alignment = useAppSelector((state) => state.demod.alignment) as Alignment;
  const sourceMode = useAppSelector((state) => state.demod.sourceMode);

  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presets, setPresets] = useState<SpanPreset[]>(loadPresetsFromStorage);
  const [isSyncing, setIsSyncing] = useState(false);
  const isPublishingLocalRangeRef = useRef(false);

  // Syncing indicator logic for source transitions
  useEffect(() => {
    setIsSyncing(true);
    const timer = setTimeout(() => setIsSyncing(false), 800);
    return () => clearTimeout(timer);
  }, [sourceMode]);



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

  const lastUserActionTimeRef = useRef<number>(0);

  const updateState = useCallback(
    (
      c: number,
      b: number,
      s: number,
      span: number,
      mode: Alignment,
      source:
        | "center"
        | "bandwidth"
        | "start"
        | "external"
        | "alignment"
        | "preview_sync"
        | "file_sync",
    ) => {
      if (source !== "preview_sync" && source !== "file_sync") {
        isPublishingLocalRangeRef.current = true;
      }

      dispatch(
        updateSpanStateThunk({
          params: { center: c, bandwidth: b, start: s, span, mode },
          source,
        }),
      );

      if (source !== "preview_sync" && source !== "file_sync") {
        setTimeout(() => {
          isPublishingLocalRangeRef.current = false;
        }, 0);
      }
    },
    [dispatch],
  );

  const isRecentlyInteracted = Date.now() - lastUserActionTimeRef.current < 1500;

  useEffect(() => {
    if (!previewRange || isRecentlyInteracted || isPublishingLocalRangeRef.current) return;

    const bw = previewRange.max - previewRange.min;

    updateState(centerFreqHz, bw, previewRange.min, hardwareSpanHz, alignment, "preview_sync");
  }, [previewRange, updateState, hardwareSpanHz, alignment, isRecentlyInteracted, centerFreqHz]);

  const handleBandwidthStartChange = (val: number) => {
    lastUserActionTimeRef.current = Date.now();
    updateState(centerFreqHz, bandwidthHz, val, hardwareSpanHz, alignment, 'start');
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

  const bandwidthStartStepHz =
    alignment === "centered" ? bandwidthHz / 2 : bandwidthHz;

  const handleApply = () => {
    lastUserActionTimeRef.current = Date.now();
    isPublishingLocalRangeRef.current = true;
    
    const halfSpan = hardwareSpanHz / 2;
    const range = { 
      min: centerFreqHz - halfSpan, 
      max: centerFreqHz + halfSpan 
    };
    
    dispatch(setFrequencyRange(range));
    dispatch(sendFrequencyRange(range));
    
    dispatch(
      updateSpanStateThunk({
        params: { 
          center: centerFreqHz, 
          bandwidth: bandwidthHz, 
          start: bandwidthStartHz,
          span: hardwareSpanHz,
          mode: alignment
        },
        source: 'external'
      })
    );

    setTimeout(() => {
      isPublishingLocalRangeRef.current = false;
    }, 100);
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
        <Title>
          {data.label || "Span"}
          {isSyncing && (
            <SyncingIndicator>
              <Loader2 size={10} className="animate-spin" />
              <span>Syncing…</span>
            </SyncingIndicator>
          )}
        </Title>
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

import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import {
  fileFrameRuntime,
  liveFrameRuntime,
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import { formatFrequency } from "@n-apt/math/frequency";
import { ChevronLeft, ChevronRight, Crosshair, Maximize } from "lucide-react";
import { createPortal } from "react-dom";
import { FullscreenModal } from "@n-apt/demodulation/react-flow/flows/FullscreenModal";
import { FrequencyInput } from "@n-apt/ui/FrequencyInput";
import {
  computeSymbolsLayout,
  getIqDataView,
  readVisibleIQSample,
  resolveAvailableSampleCount,
  resolveClosestSampleIndex,
} from "@n-apt/demodulation/react-flow/nodes/tableLayout";

type SymbolsUpdateMode = "poll" | "frame";

const UPDATE_MODE_STORAGE_KEY = "n-apt.symbols-update-mode.v1";
const POLL_INTERVAL_MS = 250;
const MAX_FRAME_RATE = 60;

const readStoredUpdateMode = (): SymbolsUpdateMode => {
  if (typeof window === "undefined") return "frame";
  try {
    return window.localStorage.getItem(UPDATE_MODE_STORAGE_KEY) === "poll"
      ? "poll"
      : "frame";
  } catch {
    return "frame";
  }
};

const OuterContainer = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  overflow: hidden;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const Header = styled.div`
  display: grid;
  grid-template-columns: minmax(200px, 1fr) auto minmax(200px, 1fr);
  background: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
  align-items: center;
`;

const DeviceTitle = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 800;
`;

const LiveBadge = styled.div`
  display: inline-flex;
  align-items: center;
  background: ${({ theme }) => theme.colors.activeBackground};
  border: 1px solid ${({ theme }) => theme.colors.primary}33;
  color: ${({ theme }) => theme.colors.primary};
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  margin-left: 12px;
`;

const PaginationControl = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 2px 4px;
`;

const PageButton = styled.button`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.surfaceHover};
    color: ${({ theme }) => theme.colors.primary};
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const PageLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textPrimary};
  min-width: 80px;
  text-align: center;
  letter-spacing: 0.05em;
`;

const MetaInfo = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
`;

const MetaInfoLabel = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  margin-right: 6px;
`;

const HeaderIconButton = styled.button<{ $active?: boolean }>`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
  opacity: ${({ $active }) => ($active ? 1 : 0.6)};
  padding: 4px;
  display: flex;
  align-items: center;

  &:hover {
    opacity: 1;
  }
`;

const CadenceButton = styled.button<{ $slow?: boolean }>`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme, $slow }) =>
    $slow ? theme.colors.textMuted : theme.colors.primary};
  cursor: pointer;
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  text-transform: uppercase;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const GotoPanel = styled.div`
  position: absolute;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  width: min(92%, 320px);
  border-radius: 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32);
  padding: 10px 12px;
`;

const GotoTitle = styled.div`
  margin-bottom: 8px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const GotoFrequencyField = styled(FrequencyInput)`
  width: 100%;

  &,
  & > div {
    width: 100%;
  }

  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;

  label {
    display: none;
  }

  input {
    flex: 1;
    min-width: 0;
    border-radius: 0;
    border: 0;
    background: transparent;
    padding: 0;
    font-size: 20px;
    line-height: 1.05;
    color: ${({ theme }) => theme.colors.textPrimary};
    font-family: ${({ theme }) => theme.typography.mono};
    letter-spacing: 0.03em;
    box-shadow: none;
  }

  input::placeholder {
    color: ${({ theme }) => theme.colors.textMuted};
    opacity: 1;
  }

  button[aria-label="Frequency unit"] {
    min-width: 48px;
    height: 30px;
    border-radius: 0;
    border: 0;
    background: transparent;
    color: ${({ theme }) => theme.colors.textSecondary};
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }
`;

const GotoHint = styled.div`
  margin-top: 8px;
  text-align: center;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textMuted};
  letter-spacing: 0.04em;
`;

const GotoResult = styled.div`
  margin-top: 6px;
  text-align: center;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  letter-spacing: 0.04em;
`;

const GotoResultValue = styled.span`
  color: ${({ theme }) => theme.colors.primary};
`;

const SubHeader = styled.div`
  display: grid;
  grid-template-columns:
    minmax(92px, 0.95fr) minmax(72px, 0.8fr) minmax(132px, 1.2fr)
    minmax(82px, 0.85fr) minmax(112px, 1fr);
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  padding: 6px 12px;
  gap: 10px;
`;

const SubHeaderCol = styled.div<{ $alignRight?: boolean }>`
  color: ${({ theme }) => theme.colors.textMuted};
  font-style: italic;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: ${(props) => (props.$alignRight ? "right" : "left")};
`;

// Rows are the hot path: they re-render on every incoming frame, so they use
// plain elements with scoped CSS instead of one styled-component instance per
// cell (which measured ~3x more expensive to reconcile).
const GridArea = styled.div`
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: 8px 12px;

  .symbols-row {
    display: grid;
    grid-template-columns:
      minmax(92px, 0.95fr) minmax(72px, 0.8fr) minmax(132px, 1.2fr)
      minmax(82px, 0.85fr) minmax(112px, 1fr);
    align-items: center;
    font-size: 13px;
    gap: 10px;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border}11;
    border-left: 2px solid transparent;
    background: transparent;

    &:hover {
      background: ${({ theme }) => theme.colors.surfaceHover};
    }
  }

  .symbols-row--highlight {
    border-left-color: ${({ theme }) => theme.colors.primary};
    background: ${({ theme }) => theme.colors.activeBackground};

    &:hover {
      background: ${({ theme }) => theme.colors.activeBackground};
    }
  }

  .symbols-cell-frequency {
    color: ${({ theme }) => theme.colors.primary};
    font-size: 11px;
    font-weight: 500;
    opacity: 0.8;
  }

  .symbols-cell-symbol {
    color: ${({ theme }) => theme.colors.textPrimary};
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .symbols-cell-iq {
    display: flex;
    gap: 8px;
    color: ${({ theme }) => theme.colors.textSecondary};
    font-size: 11px;
    min-width: 0;
  }

  .symbols-cell-i {
    color: ${({ theme }) => theme.colors.textMuted};
  }

  .symbols-cell-q {
    color: ${({ theme }) => theme.colors.primary};
  }

  .symbols-cell-phase {
    color: ${({ theme }) => theme.colors.textPrimary};
    white-space: nowrap;
  }

  .symbols-cell-power {
    color: ${({ theme }) => theme.colors.textMuted};
    text-align: right;
    font-weight: 600;
  }

  .symbols-cell-power--bright {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const TooltipContainer = styled.div`
  position: fixed;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 8px 14px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 10000;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: ${({ theme }) => theme.typography.mono};
  border-top: 2px solid ${({ theme }) => theme.colors.primary};
`;

const TooltipRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  white-space: nowrap;
`;

const TooltipSymbol = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: 800;
`;

const TooltipLabel = styled.span`
  color: ${({ theme }) => theme.colors.textMuted};
`;

const TooltipValue = styled.span<{ $color?: string; $fontWeight?: number }>`
  color: ${({ theme, $color }) => $color || theme.colors.textPrimary};
  font-weight: ${({ $fontWeight }) => $fontWeight || "normal"};
`;

const TooltipArrow = styled.div`
  position: absolute;
  bottom: -5px;
  left: 50%;
  width: 10px;
  height: 10px;
  background: ${({ theme }) => theme.colors.background};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  transform: translateX(-50%) rotate(45deg);
`;

interface SymbolsTableProps {
  frequencyRange: { min: number; max: number } | null;
}

export const SymbolsTable: React.FC<SymbolsTableProps> = ({
  frequencyRange,
}) => {
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);
  const appFrameRate = useAppSelector((state) => state.spectrum.fftFrameRate);
  const activePlaybackMetadata = useAppSelector(
    (state) => state.waterfall.activePlaybackMetadata,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [showFrequencyGoto, setShowFrequencyGoto] = useState(false);
  const [gotoRequestHz, setGotoRequestHz] = useState<number | null>(null);
  const [gotoSampleIndex, setGotoSampleIndex] = useState<number | null>(null);
  const gotoPanelRef = useRef<HTMLDivElement | null>(null);
  const [updateMode, setUpdateMode] =
    useState<SymbolsUpdateMode>(readStoredUpdateMode);

  const effectiveFrameRate = Math.min(
    Math.max(appFrameRate || MAX_FRAME_RATE, 1),
    MAX_FRAME_RATE,
  );
  const frameIntervalMs = 1000 / effectiveFrameRate;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(UPDATE_MODE_STORAGE_KEY, updateMode);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works.
    }
  }, [updateMode]);

  // Frame updates come from two interchangeable sources. "frame" reads the
  // shared frame slot once per animation frame, capped at the app frame rate;
  // "poll" falls back to the 250ms shared clock for a much lower CPU cost.
  // A rAF read (not frame-arrival notifications) is required because file
  // playback pushes into its ref without emitting arrivals.
  const [frameIqData, setFrameIqData] = useState<Uint8Array | undefined>(
    undefined,
  );
  const lastIqRefRef = useRef<unknown>(null);

  useEffect(() => {
    const sourceRef =
      sourceMode === "file" ? fileFrameRuntime.ref : liveFrameRuntime.ref;

    const readLatestIq = () => {
      const current = Array.isArray(sourceRef.current)
        ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
        : sourceRef.current;
      const nextRef = current?.iq_data as Uint8Array | undefined;

      if (nextRef !== lastIqRefRef.current) {
        lastIqRefRef.current = nextRef;
        setFrameIqData(nextRef);
      }
    };

    readLatestIq();

    if (updateMode === "poll") {
      return subscribeFrameRuntime(readLatestIq, POLL_INTERVAL_MS);
    }

    let frameHandle: number | null = null;
    let lastReadAt = 0;

    const tick = (now: number) => {
      // The 4ms fudge absorbs rAF jitter so a 60fps cap does not halve to 30.
      if (now - lastReadAt >= frameIntervalMs - 4) {
        lastReadAt = now;
        readLatestIq();
      }
      frameHandle = window.requestAnimationFrame(tick);
    };

    frameHandle = window.requestAnimationFrame(tick);

    return () => {
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
    };
  }, [sourceMode, updateMode, frameIntervalMs]);

  useEffect(() => {
    const sourceRef =
      sourceMode === "file" ? fileFrameRuntime.ref : liveFrameRuntime.ref;
    const current = Array.isArray(sourceRef.current)
      ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
      : sourceRef.current;
    lastIqRefRef.current = current?.iq_data;
    setFrameIqData(current?.iq_data as Uint8Array | undefined);
  }, [activeSourceId, sourceMode]);

  useEffect(() => {
    if (!gridRef.current) return;
    const ob = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerDims({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ob.observe(gridRef.current);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (!showFrequencyGoto) return;

    const handlePointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (gotoPanelRef.current && path.includes(gotoPanelRef.current)) {
        return;
      }
      const target = event.target as Element | null;
      if (target?.closest("[data-goto-frequency-toggle]")) {
        return;
      }
      setShowFrequencyGoto(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showFrequencyGoto]);

  const fallbackWidth =
    typeof window === "undefined"
      ? 420
      : isFullscreen
        ? Math.max(920, window.innerWidth - 160)
        : 420;
  const fallbackHeight =
    typeof window === "undefined"
      ? 320
      : isFullscreen
        ? Math.max(420, window.innerHeight - 260)
        : 320;
  const layout = computeSymbolsLayout({
    width: isFullscreen ? fallbackWidth : containerDims.width || fallbackWidth,
    height: isFullscreen
      ? fallbackHeight
      : containerDims.height || fallbackHeight,
  });
  const rowHeight = layout.rowHeight;
  const rowsCount = layout.rowsCount;
  const iqDataView = React.useMemo(
    () => getIqDataView(frameIqData),
    [frameIqData],
  );
  const totalSamples = React.useMemo(
    () => resolveAvailableSampleCount(frameIqData, fftSize || 2048),
    [fftSize, frameIqData],
  );
  const totalPages = Math.ceil(totalSamples / rowsCount) || 1;
  const currentPage = Math.min(page, totalPages - 1);
  const offsetCurrentBase = currentPage * rowsCount;

  const [hoveredCell, setHoveredCell] = useState<{
    symbol: string;
    freq: number;
    i: number;
    q: number;
    power: number;
    x: number;
    y: number;
  } | null>(null);

  // Frequency range step calculations
  const effectiveFrequencyRange = activePlaybackMetadata?.frequency_range
    ? {
        min: activePlaybackMetadata.frequency_range[0],
        max: activePlaybackMetadata.frequency_range[1],
      }
    : frequencyRange;
  const freqMin = effectiveFrequencyRange?.min ?? 18.0;
  const freqMax = effectiveFrequencyRange?.max ?? 18.2;
  const totalSpan = freqMax - freqMin;
  const stepPerSample = totalSpan / totalSamples;

  const handleNextPage = () => setPage((p) => Math.min(p + 1, totalPages - 1));
  const handlePrevPage = () => setPage((p) => Math.max(0, p - 1));

  const handleGotoFrequency = (targetHz: number) => {
    const sampleIndex = resolveClosestSampleIndex({
      frequencyHz: targetHz,
      rangeMinHz: freqMin,
      stepPerSampleHz: stepPerSample,
      sampleCount: totalSamples,
    });
    if (sampleIndex === null) return;

    setGotoRequestHz(targetHz);
    setGotoSampleIndex(sampleIndex);
    setPage(Math.floor(sampleIndex / rowsCount));
  };

  const gotoResolvedHz =
    gotoSampleIndex === null ? null : freqMin + gotoSampleIndex * stepPerSample;
  const gotoDeltaHz =
    gotoResolvedHz === null || gotoRequestHz === null
      ? null
      : gotoResolvedHz - gotoRequestHz;

  const deviceName = activeSourceDerived.deviceName || "SDR Device";

  const renderTable = (full: boolean = false) => (
    <OuterContainer style={full ? { border: "none", borderRadius: 0 } : {}}>
      <Header>
        <div style={{ display: "flex", alignItems: "center" }}>
          <DeviceTitle>{deviceName}</DeviceTitle>
          <LiveBadge>Signal Active</LiveBadge>
        </div>

        <PaginationControl>
          <PageButton onClick={handlePrevPage} disabled={currentPage === 0}>
            <ChevronLeft size={16} />
          </PageButton>
          <PageLabel>
            PAGE {currentPage + 1} / {totalPages}
          </PageLabel>
          <PageButton
            onClick={handleNextPage}
            disabled={currentPage >= totalPages - 1}
          >
            <ChevronRight size={16} />
          </PageButton>
        </PaginationControl>

        <MetaInfo>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div>
              <MetaInfoLabel>FFT SIZE:</MetaInfoLabel> {fftSize}
            </div>
            <CadenceButton
              type="button"
              aria-label="Update rate"
              aria-pressed={updateMode === "poll"}
              title={
                updateMode === "poll"
                  ? "250ms polling (low CPU) — click for frame-locked updates"
                  : `Frame-locked at ${effectiveFrameRate}fps — click for 250ms polling`
              }
              $slow={updateMode === "poll"}
              onClick={() =>
                setUpdateMode((mode) => (mode === "poll" ? "frame" : "poll"))
              }
            >
              {updateMode === "poll" ? "250ms" : `${effectiveFrameRate}fps`}
            </CadenceButton>
            <HeaderIconButton
              type="button"
              data-goto-frequency-toggle="true"
              aria-label="Go to frequency"
              aria-pressed={showFrequencyGoto}
              title="Go to frequency"
              $active={showFrequencyGoto}
              onClick={() => setShowFrequencyGoto((open) => !open)}
            >
              <Crosshair size={16} />
            </HeaderIconButton>
            {!full && (
              <button
                onClick={() => setIsFullscreen(true)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#00d4ff",
                  cursor: "pointer",
                  opacity: 0.6,
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Maximize size={16} />
              </button>
            )}
          </div>
        </MetaInfo>
      </Header>

      <SubHeader>
        <SubHeaderCol>Frequency</SubHeaderCol>
        <SubHeaderCol>Symbol</SubHeaderCol>
        <SubHeaderCol>I / Q Values</SubHeaderCol>
        <SubHeaderCol>Phase</SubHeaderCol>
        <SubHeaderCol $alignRight>Power Level</SubHeaderCol>
      </SubHeader>

      <GridArea ref={full ? null : gridRef}>
        {(full || containerDims.height > 0) &&
          Array.from({ length: rowsCount }, (_, idx) => {
            const absoluteSampleIndex = offsetCurrentBase + idx;
            const sample = readVisibleIQSample(iqDataView, absoluteSampleIndex);
            if (!sample) {
              return null;
            }
            const rowFreq = freqMin + absoluteSampleIndex * stepPerSample;
            const sI = sample.i >= 128 ? "+" : "-";
            const sQ = sample.q >= 128 ? "+" : "-";
            const phaseRad = Math.atan2(sample.q - 128, sample.i - 128);
            const phaseDeg = ((phaseRad * 180) / Math.PI + 360) % 360;
            const magnitude = Math.sqrt(
              Math.pow((sample.i - 128) / 128, 2) +
                Math.pow((sample.q - 128) / 128, 2),
            );
            const powerDbm = -70 + magnitude * 50;
            const symbol = `(${sI}, ${sQ})`;

            return (
              <div
                key={idx}
                className={
                  absoluteSampleIndex === gotoSampleIndex
                    ? "symbols-row symbols-row--highlight"
                    : "symbols-row"
                }
                style={{ height: rowHeight }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredCell({
                    symbol,
                    freq: rowFreq,
                    i: sample.i,
                    q: sample.q,
                    power: powerDbm,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
                onMouseLeave={() => setHoveredCell(null)}
              >
                <div className="symbols-cell-frequency">
                  {formatFrequency(rowFreq)}
                </div>
                <div className="symbols-cell-symbol">{symbol}</div>
                <div className="symbols-cell-iq">
                  <span className="symbols-cell-i">
                    {sample.i.toString().padStart(3, " ")}
                  </span>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span className="symbols-cell-q">
                    {sample.q.toString().padStart(3, " ")}
                  </span>
                </div>
                <div className="symbols-cell-phase">{phaseDeg.toFixed(1)}°</div>
                <div
                  className={
                    powerDbm > -40
                      ? "symbols-cell-power symbols-cell-power--bright"
                      : "symbols-cell-power"
                  }
                >
                  {powerDbm.toFixed(3)} dBm
                </div>
              </div>
            );
          })}
        {!iqDataView &&
          Array(rowsCount)
            .fill(0)
            .map((_, i) => (
              <div
                key={i}
                className="symbols-row"
                style={{ height: rowHeight }}
              >
                <div className="symbols-cell-frequency">--.--- ---</div>
                <div className="symbols-cell-symbol">--</div>
                <div className="symbols-cell-iq">
                  <span className="symbols-cell-i">--</span> |{" "}
                  <span className="symbols-cell-q">--</span>
                </div>
                <div className="symbols-cell-phase">--</div>
                <div className="symbols-cell-power">--</div>
              </div>
            ))}
      </GridArea>

      {hoveredCell &&
        createPortal(
          <TooltipContainer
            style={{
              left: hoveredCell.x,
              top: hoveredCell.y - 12,
              transform: "translate(-50%, -100%)",
            }}
          >
            <TooltipRow>
              <TooltipSymbol>SYMBOL {hoveredCell.symbol}</TooltipSymbol>
              <TooltipValue $color="#333">|</TooltipValue>
              <TooltipLabel>POWER</TooltipLabel>
              <TooltipValue
                $color={hoveredCell.power > -40 ? "#00ff88" : "#aaa"}
                $fontWeight={700}
              >
                {hoveredCell.power.toFixed(2)} dBm
              </TooltipValue>
            </TooltipRow>
            <TooltipRow>
              <TooltipLabel>I/Q:</TooltipLabel>
              <TooltipValue>
                {hoveredCell.i} | {hoveredCell.q}
              </TooltipValue>
              <TooltipValue $color="#333">|</TooltipValue>
              <TooltipLabel>FREQ:</TooltipLabel>
              <TooltipValue>{formatFrequency(hoveredCell.freq)}</TooltipValue>
            </TooltipRow>
            <TooltipArrow />
          </TooltipContainer>,
          document.body,
        )}

      {showFrequencyGoto && (full ? isFullscreen : !isFullscreen) && (
        <GotoPanel ref={gotoPanelRef} className="nodrag nopan">
          <GotoTitle>Go To Frequency</GotoTitle>
          <GotoFrequencyField
            valueHz={gotoRequestHz ?? (freqMin + freqMax) / 2}
            onChangeHz={handleGotoFrequency}
            minHz={freqMin}
            maxHz={freqMax}
            placeholder="x.xxx.xxx"
            autoFocus
            commitOnBlur
            className="nodrag nopan"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setShowFrequencyGoto(false);
              }
            }}
          />
          <GotoHint>
            Enter to jump to the nearest sample · Esc to close
          </GotoHint>
          {gotoResolvedHz !== null && gotoSampleIndex !== null && (
            <GotoResult>
              SAMPLE {gotoSampleIndex + 1} / {totalSamples} ·{" "}
              <GotoResultValue>
                {formatFrequency(gotoResolvedHz)}
              </GotoResultValue>
              {gotoDeltaHz !== null && Math.abs(gotoDeltaHz) >= 0.5
                ? ` · Δ ${formatFrequency(Math.abs(gotoDeltaHz))}`
                : " · exact"}
            </GotoResult>
          )}
        </GotoPanel>
      )}
    </OuterContainer>
  );

  return (
    <>
      {renderTable(false)}
      {isFullscreen && (
        <FullscreenModal
          title="Symbol (I/Q) Analysis"
          onClose={() => setIsFullscreen(false)}
        >
          <div style={{ height: "calc(95vh - 140px)" }}>
            {renderTable(true)}
          </div>
        </FullscreenModal>
      )}
    </>
  );
};

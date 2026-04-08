import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useAppSelector } from '@n-apt/redux';
import { liveDataRef } from '@n-apt/redux/middleware/websocketMiddleware';
import { formatFrequency } from '@n-apt/utils/frequency';
import { ChevronLeft, ChevronRight, Maximize } from 'lucide-react';
import { createPortal } from 'react-dom';
import { FullscreenModal } from '@n-apt/components/react-flow/nodes/FullscreenModal';
import {
  computeSymbolsLayout,
  getIqDataView,
  readVisibleIQSample,
  resolveAvailableSampleCount,
} from '@n-apt/components/react-flow/nodes/tableLayout';

const OuterContainer = styled.div`
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

const SubHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(92px, 0.95fr) minmax(72px, 0.8fr) minmax(132px, 1.2fr) minmax(82px, 0.85fr) minmax(112px, 1fr);
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
  text-align: ${props => props.$alignRight ? 'right' : 'left'};
`;

const GridArea = styled.div`
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: 8px 12px;
`;

const SymbolRow = styled.div<{ $rowHeight: number }>`
  display: grid;
  grid-template-columns: minmax(92px, 0.95fr) minmax(72px, 0.8fr) minmax(132px, 1.2fr) minmax(82px, 0.85fr) minmax(112px, 1fr);
  align-items: center;
  font-size: 13px;
  height: ${({ $rowHeight }) => `${$rowHeight}px`};
  gap: 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border}11;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const ColFrequency = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 11px;
  font-weight: 500;
  opacity: 0.8;
`;

const ColSymbol = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-weight: 700;
  letter-spacing: 0.05em;
`;

const ColIQ = styled.div`
  display: flex;
  gap: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  min-width: 0;
`;

const IVal = styled.span`
  color: ${({ theme }) => theme.colors.textMuted};
`;

const QVal = styled.span`
  color: ${({ theme }) => theme.colors.primary};
`;

const ColPhase = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
`;

const ColPower = styled.div<{ $magnitude: number }>`
  color: ${props => props.$magnitude > -40 ? props.theme.colors.primary : props.theme.colors.textMuted};
  text-align: right;
  font-weight: 600;
`;

const TooltipContainer = styled.div`
  position: fixed;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 8px 14px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
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
  font-weight: ${({ $fontWeight }) => $fontWeight || 'normal'};
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

export const SymbolsTable: React.FC<SymbolsTableProps> = ({ frequencyRange }) => {
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);
  const fftSize = useAppSelector(state => state.spectrum.fftSize);
  const activePlaybackMetadata = useAppSelector((state) => state.waterfall.activePlaybackMetadata);
  const playbackFrameCounter = useAppSelector((state) => state.waterfall.playbackFrameCounter);
  const dataFrameCounter = useAppSelector((state) => state.websocket.dataFrameCounter);
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!gridRef.current) return;
    const ob = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerDims({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ob.observe(gridRef.current);
    return () => ob.disconnect();
  }, []);

  const fallbackWidth = typeof window === 'undefined'
    ? 420
    : isFullscreen
      ? Math.max(920, window.innerWidth - 160)
      : 420;
  const fallbackHeight = typeof window === 'undefined'
    ? 320
    : isFullscreen
      ? Math.max(420, window.innerHeight - 260)
      : 320;
  const layout = computeSymbolsLayout({
    width: isFullscreen ? fallbackWidth : (containerDims.width || fallbackWidth),
    height: isFullscreen ? fallbackHeight : (containerDims.height || fallbackHeight),
  });
  const rowHeight = layout.rowHeight;
  const rowsCount = layout.rowsCount;
  const frameIqData = React.useMemo(() => {
    if (sourceMode === "file" && playbackFrameCounter === 0) {
      return undefined;
    }
    return liveDataRef.current?.iq_data as Uint8Array | undefined;
  }, [dataFrameCounter, playbackFrameCounter, sourceMode]);
  const iqDataView = React.useMemo(() => getIqDataView(frameIqData), [frameIqData]);
  const totalSamples = React.useMemo(
    () => resolveAvailableSampleCount(frameIqData, fftSize || 2048),
    [fftSize, frameIqData],
  );
  const totalPages = Math.ceil(totalSamples / rowsCount) || 1;
  const currentPage = Math.min(page, totalPages - 1);
  const offsetCurrentBase = currentPage * rowsCount;

  const [hoveredCell, setHoveredCell] = useState<{
    symbol: string,
    freq: number,
    i: number,
    q: number,
    power: number,
    x: number,
    y: number
  } | null>(null);

  // Frequency range step calculations
  const effectiveFrequencyRange = activePlaybackMetadata?.frequency_range
    ? {
        min: activePlaybackMetadata.frequency_range[0],
        max: activePlaybackMetadata.frequency_range[1],
      }
    : frequencyRange;
  const freqMin = effectiveFrequencyRange?.min ?? 18.000;
  const freqMax = effectiveFrequencyRange?.max ?? 18.200;
  const totalSpan = freqMax - freqMin;
  const stepPerSample = totalSpan / totalSamples;

  const handleNextPage = () => setPage(p => Math.min(p + 1, totalPages - 1));
  const handlePrevPage = () => setPage(p => Math.max(0, p - 1));

  const deviceName = reduxDeviceName || "SDR Device";

  const renderTable = (full: boolean = false) => (
    <OuterContainer style={full ? { border: 'none', borderRadius: 0 } : {}}>
      <Header>
        <div style={{ display: 'flex', alignItems: 'center' }}>
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
          <PageButton onClick={handleNextPage} disabled={currentPage >= totalPages - 1}>
            <ChevronRight size={16} />
          </PageButton>
        </PaginationControl>

        <MetaInfo>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div><MetaInfoLabel>FFT SIZE:</MetaInfoLabel> {fftSize}</div>
            {!full && (
              <button
                onClick={() => setIsFullscreen(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#00d4ff',
                  cursor: 'pointer',
                  opacity: 0.6,
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center'
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
        {(full || containerDims.height > 0) && Array.from({ length: rowsCount }, (_, idx) => {
          const absoluteSampleIndex = offsetCurrentBase + idx;
          const sample = readVisibleIQSample(iqDataView, absoluteSampleIndex);
          if (!sample) {
            return null;
          }
          const rowFreq = freqMin + (absoluteSampleIndex * stepPerSample);
          const sI = sample.i >= 128 ? "+" : "-";
          const sQ = sample.q >= 128 ? "+" : "-";
          const phaseRad = Math.atan2(sample.q - 128, sample.i - 128);
          const phaseDeg = ((phaseRad * 180) / Math.PI + 360) % 360;
          const magnitude = Math.sqrt(
            Math.pow((sample.i - 128) / 128, 2) + Math.pow((sample.q - 128) / 128, 2),
          );
          const powerDbm = -70 + (magnitude * 50);
          const symbol = `(${sI}, ${sQ})`;

          return (
            <SymbolRow
              key={idx}
              $rowHeight={rowHeight}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredCell({
                  symbol,
                  freq: rowFreq,
                  i: sample.i,
                  q: sample.q,
                  power: powerDbm,
                  x: rect.left + rect.width / 2,
                  y: rect.top
                });
              }}
              onMouseLeave={() => setHoveredCell(null)}
            >
              <ColFrequency>{formatFrequency(rowFreq)}</ColFrequency>
              <ColSymbol>{symbol}</ColSymbol>
              <ColIQ>
                <IVal>{sample.i.toString().padStart(3, ' ')}</IVal>
                <span style={{ opacity: 0.3 }}>|</span>
                <QVal>{sample.q.toString().padStart(3, ' ')}</QVal>
              </ColIQ>
              <ColPhase>{phaseDeg.toFixed(1)}°</ColPhase>
              <ColPower $magnitude={powerDbm}>
                {powerDbm.toFixed(3)} dBm
              </ColPower>
            </SymbolRow>
          );
        })}
        {!iqDataView && Array(rowsCount).fill(0).map((_, i) => (
          <SymbolRow key={i} $rowHeight={rowHeight}>
            <ColFrequency>--.--- ---</ColFrequency>
            <ColSymbol>--</ColSymbol>
            <ColIQ><IVal>--</IVal> | <QVal>--</QVal></ColIQ>
            <ColPhase>--</ColPhase>
            <ColPower $magnitude={-100}>--</ColPower>
          </SymbolRow>
        ))}
      </GridArea>

      {hoveredCell && createPortal(
        <TooltipContainer
          style={{
            left: hoveredCell.x,
            top: hoveredCell.y - 12,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <TooltipRow>
            <TooltipSymbol>SYMBOL {hoveredCell.symbol}</TooltipSymbol>
            <TooltipValue $color="#333">|</TooltipValue>
            <TooltipLabel>POWER</TooltipLabel>
            <TooltipValue $color={hoveredCell.power > -40 ? '#00ff88' : '#aaa'} $fontWeight={700}>
              {hoveredCell.power.toFixed(2)} dBm
            </TooltipValue>
          </TooltipRow>
          <TooltipRow>
            <TooltipLabel>I/Q:</TooltipLabel>
            <TooltipValue>{hoveredCell.i} | {hoveredCell.q}</TooltipValue>
            <TooltipValue $color="#333">|</TooltipValue>
            <TooltipLabel>FREQ:</TooltipLabel>
            <TooltipValue>{formatFrequency(hoveredCell.freq)}</TooltipValue>
          </TooltipRow>
          <TooltipArrow />
        </TooltipContainer>,
        document.body
      )}
    </OuterContainer>
  );

  return (
    <>
      {renderTable(false)}
      {isFullscreen && (
        <FullscreenModal title="Symbol (I/Q) Analysis" onClose={() => setIsFullscreen(false)}>
          <div style={{ height: 'calc(95vh - 140px)' }}>
            {renderTable(true)}
          </div>
        </FullscreenModal>
      )}
    </>
  );
};

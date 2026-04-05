import React, { useState, useEffect, useRef, useMemo } from 'react';
import styled from 'styled-components';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';
import { useAppSelector } from '@n-apt/redux';
import { useFFTPointsGrid } from '@n-apt/hooks/useFFTPointsGrid';
import { formatFrequency } from '@n-apt/utils/frequency';
import { ChevronLeft, ChevronRight, Maximize } from 'lucide-react';
import { createPortal } from 'react-dom';
import { FullscreenModal } from '@n-apt/components/react-flow/nodes/FullscreenModal';

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
  grid-template-columns: 140px 100px 180px 100px 1fr;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  padding: 6px 12px;
  gap: 12px;
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

const SymbolRow = styled.div`
  display: grid;
  grid-template-columns: 140px 100px 180px 100px 1fr;
  align-items: center;
  font-size: 13px;
  height: 32px;
  gap: 12px;
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
  gap: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
`;

const IVal = styled.span`
  color: ${({ theme }) => theme.colors.textMuted};
`;

const QVal = styled.span`
  color: ${({ theme }) => theme.colors.primary};
`;

const ColPhase = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
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
  const { wsConnection } = useSpectrumStore();
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);
  const fftSize = useAppSelector(state => state.spectrum.fftSize);

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

  const rowHeight = 33; // 32px + 1px border
  const rowsCount = Math.max(1, Math.floor((containerDims.height - 16) / rowHeight));

  const totalSamples = fftSize || 2048;
  const totalPages = Math.ceil(totalSamples / rowsCount) || 1;
  const currentPage = Math.min(page, totalPages - 1);
  const offsetCurrentBase = currentPage * rowsCount;

  const { points } = useFFTPointsGrid(rowsCount, offsetCurrentBase);

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
  const freqMin = frequencyRange?.min ?? 18.000;
  const freqMax = frequencyRange?.max ?? 18.200;
  const totalSpan = freqMax - freqMin;
  const stepPerSample = totalSpan / totalSamples;

  const handleNextPage = () => setPage(p => Math.min(p + 1, totalPages - 1));
  const handlePrevPage = () => setPage(p => Math.max(0, p - 1));

  const deviceName = wsConnection.deviceName || reduxDeviceName || "SDR Device";

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
        {(full || containerDims.height > 0) && points.map((p, idx) => {
          const absoluteSampleIndex = offsetCurrentBase + idx;
          const rowFreq = freqMin + (absoluteSampleIndex * stepPerSample);

          return (
            <SymbolRow
              key={idx}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredCell({
                  symbol: p.symbol,
                  freq: rowFreq,
                  i: p.i,
                  q: p.q,
                  power: p.powerDbm,
                  x: rect.left + rect.width / 2,
                  y: rect.top
                });
              }}
              onMouseLeave={() => setHoveredCell(null)}
            >
              <ColFrequency>{formatFrequency(rowFreq)}</ColFrequency>
              <ColSymbol>{p.symbol}</ColSymbol>
              <ColIQ>
                <IVal>{p.i.toString().padStart(3, ' ')}</IVal>
                <span style={{ opacity: 0.3 }}>|</span>
                <QVal>{p.q.toString().padStart(3, ' ')}</QVal>
              </ColIQ>
              <ColPhase>{p.phaseDeg.toFixed(1)}°</ColPhase>
              <ColPower $magnitude={p.powerDbm}>
                {p.powerDbm.toFixed(3)} dBm
              </ColPower>
            </SymbolRow>
          );
        })}
        {points.length === 0 && Array(rowsCount).fill(0).map((_, i) => (
          <SymbolRow key={i}>
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
          <div style={{ height: 'calc(95vh - 100px)' }}>
            {renderTable(true)}
          </div>
        </FullscreenModal>
      )}
    </>
  );
};

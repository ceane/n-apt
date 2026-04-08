import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useAppSelector } from '@n-apt/redux';
import { liveDataRef } from '@n-apt/redux/middleware/websocketMiddleware';
import { formatFrequency } from '@n-apt/utils/frequency';
import { ChevronLeft, ChevronRight, Maximize } from 'lucide-react';
import { FullscreenModal } from '@n-apt/components/react-flow/nodes/FullscreenModal';
import {
  computeBitstreamLayout,
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

const DeviceInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
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

const SubHeader = styled.div<{ $addressWidth: number; $gap: number }>`
  display: grid;
  grid-template-columns: ${({ $addressWidth }) => `${$addressWidth}px minmax(0, 1fr)`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  padding: 6px 12px;
  gap: ${({ $gap }) => `${$gap}px`};
`;

const SubHeaderCol = styled.div`
  color: ${({ theme }) => theme.colors.textMuted};
  font-style: italic;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const GridArea = styled.div`
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: 8px 12px;
`;

const HexRow = styled.div<{ $addressWidth: number; $gap: number; $rowHeight: number }>`
  display: grid;
  grid-template-columns: ${({ $addressWidth }) => `${$addressWidth}px minmax(0, 1fr)`};
  align-items: center;
  min-height: ${({ $rowHeight }) => `${$rowHeight}px`};
  gap: ${({ $gap }) => `${$gap}px`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border}11;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const AddrCell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const AddrLabel = styled.div`
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 11px;
`;

const AddrFreq = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 9px;
  opacity: 0.6;
`;

const ByteGrid = styled.div<{ $columns: number; $gap: number }>`
  display: grid;
  grid-template-columns: ${({ $columns }) => `repeat(${$columns}, minmax(0, 1fr))`};
  gap: ${({ $gap }) => `${$gap}px`};
  align-items: center;
`;

const HexByte = styled.span<{ $isFirst?: boolean }>`
  color: ${({ theme, $isFirst }) => $isFirst ? theme.colors.primary : theme.colors.textSecondary};
  font-size: 13px;
  font-weight: ${({ $isFirst }) => $isFirst ? 700 : 400};
  text-align: center;
  cursor: help;
  padding: 4px 2px;
  border-radius: 2px;
  letter-spacing: 0.05em;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}22;
    color: ${({ theme }) => theme.colors.primary};
  }
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

const TooltipLabel = styled.span`
  color: ${({ theme }) => theme.colors.textMuted};
`;

const TooltipValue = styled.span<{ $color?: string }>`
  color: ${({ theme, $color }) => $color || theme.colors.textPrimary};
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

interface BitstreamViewerProps {
  frequencyRange: { min: number; max: number } | null;
}

export const BitstreamViewer: React.FC<BitstreamViewerProps> = ({ frequencyRange }) => {
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
      if (entry) setContainerDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ob.observe(gridRef.current);
    return () => ob.disconnect();
  }, []);

  const fallbackWidth = typeof window === 'undefined'
    ? 440
    : isFullscreen
      ? Math.max(960, window.innerWidth - 160)
      : 440;
  const fallbackHeight = typeof window === 'undefined'
    ? 320
    : isFullscreen
      ? Math.max(420, window.innerHeight - 260)
      : 320;
  const layout = computeBitstreamLayout({
    width: isFullscreen ? fallbackWidth : (containerDims.width || fallbackWidth),
    height: isFullscreen ? fallbackHeight : (containerDims.height || fallbackHeight),
  });
  const rowHeight = layout.rowHeight;
  const rowsCount = layout.rowsCount;
  const iqPairsPerRow = layout.iqPairsPerRow;
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
  const pageSampleSize = rowsCount * iqPairsPerRow;
  const totalPages = Math.ceil(totalSamples / pageSampleSize) || 1;
  const currentPage = Math.min(page, totalPages - 1);
  const offsetCurrentBase = currentPage * pageSampleSize;

  // We fetch IQ_PAIRS_PER_ROW samples per row
  const fileFrameRate = activePlaybackMetadata?.frame_rate;
  const liveIqData = frameIqData;
  const isLive = sourceMode === "live" && Boolean(liveIqData && liveIqData.length > 0);

  const [hoveredByte, setHoveredByte] = useState<{
    hex: string;
    decimal: number;
    type: 'I' | 'Q';
    freq: number;
    x: number;
    y: number;
  } | null>(null);

  const effectiveFrequencyRange = activePlaybackMetadata?.frequency_range
    ? {
        min: activePlaybackMetadata.frequency_range[0],
        max: activePlaybackMetadata.frequency_range[1],
      }
    : frequencyRange;
  const freqMin = effectiveFrequencyRange?.min ?? 18.000;
  const freqMax = effectiveFrequencyRange?.max ?? 18.200;
  const totalSpan = freqMax - freqMin;

  const handleNextPage = () => setPage(p => Math.min(p + 1, totalPages - 1));
  const handlePrevPage = () => setPage(p => Math.max(0, p - 1));

  const deviceName = reduxDeviceName || "SDR Device";

  // Build rows: each row = iqPairsPerRow points → 2 bytes per point
  const rows: React.ReactNode[] = [];
  for (let rowIdx = 0; rowIdx < rowsCount; rowIdx++) {
    const sampleBase = offsetCurrentBase + rowIdx * iqPairsPerRow;

    // Address: byte offset = sampleBase * 2 (each IQ pair = 2 bytes)
    const byteOffset = sampleBase * 2;
    const addrHex = byteOffset.toString(16).padStart(8, '0').toUpperCase();

    // Frequency range for this row
    const rowFreqStart = freqMin + (sampleBase / totalSamples) * totalSpan;
    const rowFreqEnd = freqMin + ((sampleBase + iqPairsPerRow) / totalSamples) * totalSpan;

    // Build the row bytes: alternating I and Q
    const hexBytes: { hex: string; decimal: number; type: 'I' | 'Q'; freq: number }[] = [];
    for (let pairIdx = 0; pairIdx < iqPairsPerRow; pairIdx++) {
      const p = readVisibleIQSample(iqDataView, sampleBase + pairIdx);
      const sampleFreq = freqMin + ((sampleBase + pairIdx) / totalSamples) * totalSpan;
      if (p) {
        hexBytes.push({ hex: p.i.toString(16).padStart(2, '0').toUpperCase(), decimal: p.i, type: 'I', freq: sampleFreq });
        hexBytes.push({ hex: p.q.toString(16).padStart(2, '0').toUpperCase(), decimal: p.q, type: 'Q', freq: sampleFreq });
      } else {
        hexBytes.push({ hex: '--', decimal: 0, type: 'I', freq: sampleFreq });
        hexBytes.push({ hex: '--', decimal: 0, type: 'Q', freq: sampleFreq });
      }
    }

    rows.push(
      <HexRow
        key={rowIdx}
        $addressWidth={layout.addressColumnWidth}
        $gap={layout.gap}
        $rowHeight={rowHeight}
      >
        <AddrCell>
          <AddrLabel>{addrHex}</AddrLabel>
          <AddrFreq>{formatFrequency(rowFreqStart)} – {formatFrequency(rowFreqEnd)}</AddrFreq>
        </AddrCell>
        <ByteGrid $columns={layout.bytesPerRow} $gap={Math.max(4, Math.floor(layout.gap / 2))}>
          {hexBytes.map((b, byteIdx) => (
            <HexByte
              key={byteIdx}
              $isFirst={byteIdx === 0}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredByte({
                  hex: b.hex,
                  decimal: b.decimal,
                  type: b.type,
                  freq: b.freq,
                  x: rect.left + rect.width / 2,
                  y: rect.top
                });
              }}
              onMouseLeave={() => setHoveredByte(null)}
            >
              {b.hex}
            </HexByte>
          ))}
        </ByteGrid>
      </HexRow>
    );
  }

  const renderContent = (full: boolean = false) => (
    <OuterContainer style={full ? { border: 'none', borderRadius: 0 } : {}}>
      <Header>
        <DeviceInfo>
          <DeviceTitle>{deviceName}</DeviceTitle>
          {isLive && <LiveBadge>Live Buffer</LiveBadge>}
        </DeviceInfo>

        <PaginationControl>
          <PageButton onClick={handlePrevPage} disabled={currentPage === 0}>
            <ChevronLeft size={16} />
          </PageButton>
          <PageLabel>PAGE {currentPage + 1} / {totalPages}</PageLabel>
          <PageButton onClick={handleNextPage} disabled={currentPage >= totalPages - 1}>
            <ChevronRight size={16} />
          </PageButton>
        </PaginationControl>

        <MetaInfo>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div><MetaInfoLabel>FFT SIZE:</MetaInfoLabel> {fftSize}</div>
            {typeof fileFrameRate === 'number' && Number.isFinite(fileFrameRate) && fileFrameRate > 0 && (
              <div><MetaInfoLabel>FPS:</MetaInfoLabel> {fileFrameRate.toFixed(1)}</div>
            )}
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

      <SubHeader $addressWidth={layout.addressColumnWidth} $gap={layout.gap}>
        <SubHeaderCol>Memory Offset</SubHeaderCol>
        <SubHeaderCol>Raw High-Density Signal Buffer (Hex)</SubHeaderCol>
      </SubHeader>

      <GridArea ref={full ? null : gridRef}>
        {(full || containerDims.height > 0) && rows}
      </GridArea>

      {hoveredByte && createPortal(
        <TooltipContainer
          style={{
            left: hoveredByte.x,
            top: hoveredByte.y - 12,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <TooltipRow>
            <TooltipLabel>HEX:</TooltipLabel>
            <TooltipValue>0x{hoveredByte.hex}</TooltipValue>
            <TooltipValue $color="#333">|</TooltipValue>
            <TooltipLabel>DEC:</TooltipLabel>
            <TooltipValue>{hoveredByte.decimal}</TooltipValue>
          </TooltipRow>
          <TooltipRow>
            <TooltipLabel>TYPE:</TooltipLabel>
            <TooltipValue $color={hoveredByte.type === 'I' ? '#ff3366' : '#33ccff'} style={{ fontWeight: 700 }}>
              {hoveredByte.type} sample
            </TooltipValue>
            <TooltipValue $color="#333">|</TooltipValue>
            <TooltipLabel>FREQ:</TooltipLabel>
            <TooltipValue style={{ color: '#00d4ff' }}>{formatFrequency(hoveredByte.freq)}</TooltipValue>
          </TooltipRow>
          <TooltipArrow />
        </TooltipContainer>,
        document.body
      )}
    </OuterContainer>
  );

  return (
    <>
      {renderContent(false)}
      {isFullscreen && (
        <FullscreenModal title="Bitstream Analysis" onClose={() => setIsFullscreen(false)}>
          <div style={{ height: 'calc(95vh - 140px)' }}>
            {renderContent(true)}
          </div>
        </FullscreenModal>
      )}
    </>
  );
};

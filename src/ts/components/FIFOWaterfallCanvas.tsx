import { FC, Suspense } from "react";
import styled from "styled-components";

const WaterfallSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #8a8f98;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: #5a6069;
  }
`;

const CanvasWrapper = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid ${(props) => props.theme.canvasBorder};
  border-radius: 8px;
  overflow: hidden;
  background-color: ${(props) => props.theme.background};
`;

const CanvasLayer = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  will-change: width, height;
`;

const HighlightOverlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

const HighlightBand = styled.div<{ $left: number; $width: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $left }) => `${$left}%`};
  width: ${({ $width }) => `${$width}%`};
  background: rgba(255, 206, 84, 0.18);
  box-shadow: inset 0 0 0 1px rgba(255, 206, 84, 0.7);
`;

interface FIFOWaterfallCanvasProps {
  isPaused: boolean;
  setWaterfallGpuCanvasNode: (node: HTMLCanvasElement | null) => void;
  setWaterfallOverlayCanvasNode: (node: HTMLCanvasElement | null) => void;
  heterodyningHighlightedBins?: Array<{ start: number; end: number }>;
}

const FIFOWaterfallCanvas: FC<FIFOWaterfallCanvasProps> = ({
  isPaused,
  setWaterfallGpuCanvasNode,
  setWaterfallOverlayCanvasNode,
  heterodyningHighlightedBins = [],
}) => {
  return (
    <Suspense fallback={<div>Loading waterfall...</div>}>
      <WaterfallSection>
        <SectionTitle>
          Waterfall Display {isPaused && "(Paused)"}
        </SectionTitle>
        <CanvasWrapper>
          <CanvasLayer
            ref={setWaterfallGpuCanvasNode}
            id="fft-waterfall-canvas-webgpu"
          />
          <CanvasLayer
            ref={setWaterfallOverlayCanvasNode}
            id="fft-waterfall-canvas-overlay"
          />
          {heterodyningHighlightedBins.length > 0 && (
            <HighlightOverlay data-testid="fifo-waterfall-highlight-overlay">
              {heterodyningHighlightedBins.map((bin, index) => (
                <HighlightBand
                  key={`waterfall-highlight-${index}`}
                  data-testid="fifo-waterfall-highlight-band"
                  $left={Math.max(0, Math.min(100, bin.start * 100))}
                  $width={Math.max(0.2, Math.min(100, (bin.end - bin.start) * 100))}
                />
              ))}
            </HighlightOverlay>
          )}
        </CanvasWrapper>
      </WaterfallSection>
    </Suspense>
  );
};

export default FIFOWaterfallCanvas;

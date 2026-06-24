import { FC, Suspense, type ReactNode } from "react";
import styled from "styled-components";
import CanvasPlaceholder, {
  type CanvasPlaceholderState,
} from "@n-apt/components/ui/CanvasPlaceholder";
import { SECTION_TITLE_COLOR, SECTION_TITLE_AFTER_COLOR } from "@n-apt/consts";

const EMPTY_HETERODYNING_HIGHLIGHTED_BINS: Array<{
  start: number;
  end: number;
}> = [];

const WaterfallSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  padding: 2px 2px 12px;
  box-sizing: border-box;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${SECTION_TITLE_COLOR};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: ${SECTION_TITLE_AFTER_COLOR};
  }
`;

const SectionTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  padding: 0 0 10px;
  margin-bottom: 0;
`;

const SectionTitleActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  transition: opacity 0.15s ease;

  &[data-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
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
  headerActionContent?: ReactNode;
  heterodyningHighlightedBins?: Array<{ start: number; end: number }>;
  awaitingDeviceData?: boolean | string;
  placeholderSourceLabel?: string;
  placeholderPaneLabel?: string;
  placeholderErrorReason?: string | null;
  placeholderState?: CanvasPlaceholderState | null;
  isStandby?: boolean;
}

const FIFOWaterfallCanvas: FC<FIFOWaterfallCanvasProps> = ({
  isPaused,
  setWaterfallGpuCanvasNode,
  setWaterfallOverlayCanvasNode,
  headerActionContent,
  heterodyningHighlightedBins = EMPTY_HETERODYNING_HIGHLIGHTED_BINS,
  awaitingDeviceData = false,
  placeholderSourceLabel,
  placeholderPaneLabel = "Waterfall",
  placeholderErrorReason = null,
  placeholderState: explicitPlaceholderState = null,
  isStandby: explicitIsStandby,
}) => {
  const isStandby =
    typeof explicitIsStandby === "boolean"
      ? explicitIsStandby
      : !!(
          explicitPlaceholderState &&
          explicitPlaceholderState.kind === "idle" &&
          explicitPlaceholderState.title === "Start Tx to transmit"
        );

  const placeholderState = (() => {
    if (explicitPlaceholderState) {
      return explicitPlaceholderState;
    }

    if (placeholderErrorReason) {
      return {
        kind: "error" as const,
        sourceLabel: placeholderSourceLabel,
        reason: placeholderErrorReason,
      } satisfies CanvasPlaceholderState;
    }

    if (awaitingDeviceData) {
      return {
        kind: "loading" as const,
        sourceLabel: placeholderSourceLabel,
        paneLabel: placeholderPaneLabel,
        message:
          typeof awaitingDeviceData === "string"
            ? awaitingDeviceData
            : undefined,
      } satisfies CanvasPlaceholderState;
    }

    return null;
  })();

  return (
    <Suspense fallback={<div>Loading waterfall…</div>}>
      <WaterfallSection>
        <SectionTitleRow>
          <SectionTitle>
            {isStandby
              ? "Waterfall Display (Standby)"
              : `Waterfall Display ${isPaused ? "(Paused)" : ""}`}
          </SectionTitle>
          {headerActionContent && (
            <SectionTitleActions data-disabled={!!placeholderState}>
              {headerActionContent}
            </SectionTitleActions>
          )}
        </SectionTitleRow>
        <CanvasWrapper>
          {placeholderState && <CanvasPlaceholder state={placeholderState} />}
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
              {heterodyningHighlightedBins.map((bin) => (
                <HighlightBand
                  key={`waterfall-highlight-${bin.start}-${bin.end}`}
                  data-testid="fifo-waterfall-highlight-band"
                  $left={Math.max(0, Math.min(100, bin.start * 100))}
                  $width={Math.max(
                    0.2,
                    Math.min(100, (bin.end - bin.start) * 100),
                  )}
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

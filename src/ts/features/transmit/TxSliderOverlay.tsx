import React, { useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import { Signal, Zap } from "lucide-react";
import {
  computeEdgeResizedBand,
  getPointerOffsetWithinBandHz,
  computeBandPanWithEdgePanning,
} from "@n-apt/spectrum/public/edgePanning";

const OverlayRoot = styled.div`
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 106px;
  z-index: 160;
  pointer-events: none;
  user-select: none;
`;

const OverlayCard = styled.div`
  pointer-events: auto;
  display: grid;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(
    180deg,
    rgba(8, 10, 14, 0.72),
    rgba(4, 6, 10, 0.84)
  );
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(10px);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  pointer-events: auto;
`;

const Title = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${(props) => props.theme.textPrimary};
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: none;
  color: ${(props) => props.theme.primary};
  background: ${(props) => `${props.theme.primary}14`};
  border: 1px solid ${(props) => `${props.theme.primary}33`};
  border-radius: 999px;
  padding: 4px 8px;
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
`;

const Body = styled.div`
  display: grid;
  gap: 8px;
  pointer-events: auto;
`;

const BandTrack = styled.div`
  position: relative;
  height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
  cursor: grab;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
`;

const BandFill = styled.div<{ $left: number; $width: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $left }) => `${$left}%`};
  width: ${({ $width }) => `${$width}%`};
  border-radius: 999px;
  background: linear-gradient(90deg, #ff1f8f 0%, #ff7a18 100%);
  box-shadow: 0 0 0 1px rgba(255, 122, 24, 0.65);
`;

const BandHandle = styled.div<{ $left: number }>`
  position: absolute;
  top: 50%;
  left: ${({ $left }) => `${$left}%`};
  width: 16px;
  height: 16px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border: 2px solid #ff7a18;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.22);
`;

const Value = styled.div`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
`;

const Slider = styled.input`
  width: 100%;
  accent-color: ${(props) => props.theme.primary};
`;

const Marks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  opacity: 0.7;
  padding-inline: 2px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  opacity: 0.8;
`;

export interface TxSliderOverlayProps {
  deviceLabel?: string;
  signalLabel: string;
  visibleMinHz: number;
  visibleMaxHz: number;
  txCenterHz: number;
  txSampleRateHz: number;
  powerDbm?: number;
  onCenterFrequencyChange?: (valueHz: number, isDragging?: boolean) => void;
  onSampleRateChange?: (valueHz: number) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
}

const formatHz = (value: number) => {
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(3)}MHz`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}kHz`;
  return `${Math.round(value)}Hz`;
};

export const TxSliderOverlay: React.FC<TxSliderOverlayProps> = ({
  deviceLabel,
  signalLabel,
  visibleMinHz,
  visibleMaxHz,
  txCenterHz,
  txSampleRateHz,
  powerDbm = 0,
  onCenterFrequencyChange,
  onSampleRateChange,
  onFrequencyRangeChange,
}) => {
  const displayedSampleRateHz = txSampleRateHz;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const draggingModeRef = useRef<"band" | "edge" | null>(null);
  const draggingHandleRef = useRef<"left" | "right" | null>(null);
  const draggingOffsetHzRef = useRef(0);
  const lastEmittedCenterHzRef = useRef<number | null>(null);
  const latestDragStateRef = useRef({
    visibleMinHz,
    visibleMaxHz,
    txCenterHz,
    txSampleRateHz: displayedSampleRateHz,
    onCenterFrequencyChange,
    onSampleRateChange,
  });

  latestDragStateRef.current = {
    visibleMinHz,
    visibleMaxHz,
    txCenterHz,
    txSampleRateHz: displayedSampleRateHz,
    onCenterFrequencyChange,
    onSampleRateChange,
  };

  const stopCanvasInteraction = (event: React.SyntheticEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const stopNativeCanvasInteraction = (event: Event) => {
      event.preventDefault();

      if (event instanceof PointerEvent) {
        const track = trackRef.current;
        const target = event.target instanceof Node ? event.target : null;
        const isTrackEvent = !!track && !!target && track.contains(target);
        const updateFromPointer = () => {
          if (!track) return;
          const rect = track.getBoundingClientRect();
          if (rect.width <= 0) return;
          const {
            visibleMinHz,
            visibleMaxHz,
            txCenterHz,
            txSampleRateHz,
            onCenterFrequencyChange,
            onSampleRateChange,
          } = latestDragStateRef.current;
          const ratio = Math.max(
            0,
            Math.min(1, (event.clientX - rect.left) / rect.width),
          );
          const span = Math.max(1, visibleMaxHz - visibleMinHz);
          const pointerFreq = visibleMinHz + ratio * span;

          if (
            !Number.isFinite(pointerFreq) ||
            !Number.isFinite(visibleMinHz) ||
            !Number.isFinite(visibleMaxHz) ||
            !Number.isFinite(txCenterHz) ||
            !Number.isFinite(txSampleRateHz)
          ) {
            return;
          }

          const halfSpan = Math.max(0, txSampleRateHz / 2);
          const currentStart = txCenterHz - halfSpan;
          const currentEnd = txCenterHz + halfSpan;

          if (event.type === "pointerdown") {
            const distToLeft = Math.abs(pointerFreq - currentStart);
            const distToRight = Math.abs(pointerFreq - currentEnd);
            const hzPerPx = span / rect.width;
            const handleHitHz = Math.max(12 * hzPerPx, 1);
            const isInsideBand =
              pointerFreq >= currentStart && pointerFreq <= currentEnd;
            const isOnLeftHandle = distToLeft <= handleHitHz;
            const isOnRightHandle = distToRight <= handleHitHz;

            if (isInsideBand && !isOnLeftHandle && !isOnRightHandle) {
              draggingModeRef.current = "band";
              draggingHandleRef.current = null;
              draggingOffsetHzRef.current = getPointerOffsetWithinBandHz(
                pointerFreq,
                currentStart,
              );
            } else {
              draggingModeRef.current = "edge";
              draggingHandleRef.current =
                distToLeft < distToRight ? "left" : "right";
              draggingOffsetHzRef.current = 0;
            }
          }

          const nextBand =
            draggingModeRef.current === "band"
              ? computeBandPanWithEdgePanning({
                  visibleMinHz,
                  visibleMaxHz,
                  startHz: currentStart,
                  endHz: currentEnd,
                  pointerHz: pointerFreq,
                  pointerOffsetHz: draggingOffsetHzRef.current,
                })
              : draggingHandleRef.current
                ? computeEdgeResizedBand({
                    visibleMinHz,
                    visibleMaxHz,
                    startHz: currentStart,
                    endHz: currentEnd,
                    pointerHz: pointerFreq,
                    activeHandle: draggingHandleRef.current,
                  })
                : null;
          if (!nextBand) return;

          if (
            Number.isFinite(nextBand.sampleRateHz) &&
            Number.isFinite(nextBand.centerHz)
          ) {
            onSampleRateChange?.(nextBand.sampleRateHz);
            onCenterFrequencyChange?.(nextBand.centerHz, true);
            lastEmittedCenterHzRef.current = nextBand.centerHz;
            if ("visibleMinHz" in nextBand) {
              const panResult = nextBand as any;
              if (
                panResult.visibleMinHz !== visibleMinHz ||
                panResult.visibleMaxHz !== visibleMaxHz
              ) {
                onFrequencyRangeChange?.({
                  min: panResult.visibleMinHz,
                  max: panResult.visibleMaxHz,
                });
              }
            }
          }
        };

        if (event.type === "pointerdown" && isTrackEvent) {
          draggingRef.current = true;
          (event.target as HTMLElement | null)?.setPointerCapture?.(
            event.pointerId,
          );
          updateFromPointer();
        } else if (event.type === "pointermove" && draggingRef.current) {
          updateFromPointer();
        } else if (
          event.type === "pointerup" ||
          event.type === "pointercancel"
        ) {
          if (draggingRef.current) {
            const finalFreq =
              lastEmittedCenterHzRef.current ??
              latestDragStateRef.current.txCenterHz;
            latestDragStateRef.current.onCenterFrequencyChange?.(
              finalFreq,
              false,
            );
          }
          draggingRef.current = false;
          draggingModeRef.current = null;
          draggingHandleRef.current = null;
          draggingOffsetHzRef.current = 0;
          lastEmittedCenterHzRef.current = null;
          (event.target as HTMLElement | null)?.releasePointerCapture?.(
            event.pointerId,
          );
        }
      }

      event.stopImmediatePropagation();
    };

    const events: Array<keyof HTMLElementEventMap> = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "mousedown",
      "mousemove",
      "mouseup",
      "touchstart",
      "touchmove",
      "touchend",
      "wheel",
    ];

    for (const eventName of events) {
      root.addEventListener(eventName, stopNativeCanvasInteraction, {
        capture: true,
        passive: false,
      });
    }

    return () => {
      for (const eventName of events) {
        root.removeEventListener(eventName, stopNativeCanvasInteraction, {
          capture: true,
        });
      }
    };
  }, []);

  const band = useMemo(() => {
    const span = Math.max(1, visibleMaxHz - visibleMinHz);
    const halfSpan = Math.max(0, displayedSampleRateHz / 2);
    const start = txCenterHz - halfSpan;
    const end = txCenterHz + halfSpan;
    const center = (start + end) / 2;
    const left = ((start - visibleMinHz) / span) * 100;
    const width = ((end - start) / span) * 100;
    return {
      left,
      width,
      center: ((center - visibleMinHz) / span) * 100,
      start,
      end,
      centerHz: center,
    };
  }, [displayedSampleRateHz, txCenterHz, visibleMaxHz, visibleMinHz]);
  const displayLabel = deviceLabel
    ? `${deviceLabel} > ${signalLabel}`
    : signalLabel;

  return (
    <OverlayRoot
      ref={rootRef}
      data-tx-slider-overlay="true"
      onClick={stopCanvasInteraction}
      onDoubleClick={stopCanvasInteraction}
      onMouseDown={stopCanvasInteraction}
      onMouseMove={stopCanvasInteraction}
      onMouseUp={stopCanvasInteraction}
      onPointerDown={stopCanvasInteraction}
      onPointerMove={stopCanvasInteraction}
      onPointerUp={stopCanvasInteraction}
      onTouchStart={stopCanvasInteraction}
      onTouchMove={stopCanvasInteraction}
      onTouchEnd={stopCanvasInteraction}
      onWheel={stopCanvasInteraction}
    >
      <OverlayCard>
        <Header>
          <Title>
            <Signal size={13} strokeWidth={2} />
            Tx Slider
          </Title>
        </Header>
        <LabelRow>
          <Badge>{displayLabel}</Badge>
        </LabelRow>
        <Body>
          <BandTrack
            ref={trackRef}
            aria-label="Transmit frequency band"
            role="slider"
            aria-valuemin={Math.round(visibleMinHz)}
            aria-valuemax={Math.round(visibleMaxHz)}
            aria-valuenow={Math.round(txCenterHz)}
            tabIndex={0}
          >
            <BandFill $left={band.left} $width={band.width} />
            <BandHandle $left={band.left} />
            <BandHandle $left={band.left + band.width} />
          </BandTrack>
          <Marks>
            <span>{formatHz(band.start)}</span>
            <span>{formatHz(band.centerHz)}</span>
            <span>{formatHz(band.end)}</span>
          </Marks>
          <Hint>
            {formatHz(displayedSampleRateHz)} sample rate · {formatHz(band.centerHz)}{" "}
            center ·{" "}
            <Zap
              size={10}
              strokeWidth={2.2}
              style={{
                display: "inline-block",
                verticalAlign: "-1px",
                marginRight: "2px",
              }}
            />
            {(Number.isFinite(powerDbm) ? powerDbm : 0).toFixed(1)} dBm target
          </Hint>
        </Body>
      </OverlayCard>
    </OverlayRoot>
  );
};

export default TxSliderOverlay;

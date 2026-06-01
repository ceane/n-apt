import React, { useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import { Signal } from "lucide-react";
import { clampFrequencyHz } from "@n-apt/utils/frequency";

const OverlayRoot = styled.div`
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 72px;
  z-index: 160;
  pointer-events: auto;
  user-select: none;
`;

const OverlayCard = styled.div`
  pointer-events: auto;
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(
    180deg,
    rgba(8, 10, 14, 0.82),
    rgba(4, 6, 10, 0.92)
  );
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${(props) => props.theme.primary};
  background: ${(props) => `${props.theme.primary}14`};
  border: 1px solid ${(props) => `${props.theme.primary}33`};
  border-radius: 999px;
  padding: 4px 8px;
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
  signalLabel: string;
  visibleMinHz: number;
  visibleMaxHz: number;
  txCenterHz: number;
  txSampleRateHz: number;
  powerDbm?: number;
  onCenterFrequencyChange?: (valueHz: number) => void;
  onSampleRateChange?: (valueHz: number) => void;
}

const formatHz = (value: number) => {
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(3)}MHz`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}kHz`;
  return `${Math.round(value)}Hz`;
};

export const TxSliderOverlay: React.FC<TxSliderOverlayProps> = ({
  signalLabel,
  visibleMinHz,
  visibleMaxHz,
  txCenterHz,
  txSampleRateHz,
  powerDbm = 0,
  onCenterFrequencyChange,
  onSampleRateChange,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const draggingHandleRef = useRef<"left" | "right" | null>(null);
  const latestDragStateRef = useRef({
    visibleMinHz,
    visibleMaxHz,
    txCenterHz,
    txSampleRateHz,
    onCenterFrequencyChange,
    onSampleRateChange,
  });

  useEffect(() => {
    latestDragStateRef.current = {
      visibleMinHz,
      visibleMaxHz,
      txCenterHz,
      txSampleRateHz,
      onCenterFrequencyChange,
      onSampleRateChange,
    };
  }, [
    onCenterFrequencyChange,
    onSampleRateChange,
    visibleMaxHz,
    visibleMinHz,
    txCenterHz,
    txSampleRateHz,
  ]);

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

          const currentCenter = clampFrequencyHz(
            txCenterHz,
            visibleMinHz,
            visibleMaxHz,
          );
          const halfWidth = Math.max(1, txSampleRateHz / 2);
          const currentStart = clampFrequencyHz(
            currentCenter - halfWidth,
            visibleMinHz,
            visibleMaxHz,
          );
          const currentEnd = clampFrequencyHz(
            currentCenter + halfWidth,
            visibleMinHz,
            visibleMaxHz,
          );

          if (event.type === "pointerdown") {
            const distToLeft = Math.abs(pointerFreq - currentStart);
            const distToRight = Math.abs(pointerFreq - currentEnd);
            draggingHandleRef.current =
              distToLeft < distToRight ? "left" : "right";
          }

          const activeHandle = draggingHandleRef.current;
          if (!activeHandle) return;

          if (activeHandle === "left") {
            const nextStart = Math.max(
              visibleMinHz,
              Math.min(pointerFreq, currentEnd - 100_000),
            );
            const nextSampleRate = currentEnd - nextStart;
            const nextCenter = nextStart + nextSampleRate / 2;
            onSampleRateChange?.(Math.round(nextSampleRate));
            onCenterFrequencyChange?.(Math.round(nextCenter));
          } else {
            const nextEnd = Math.max(
              currentStart + 100_000,
              Math.min(pointerFreq, visibleMaxHz),
            );
            const nextSampleRate = nextEnd - currentStart;
            const nextCenter = currentStart + nextSampleRate / 2;
            onSampleRateChange?.(Math.round(nextSampleRate));
            onCenterFrequencyChange?.(Math.round(nextCenter));
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
          draggingRef.current = false;
          draggingHandleRef.current = null;
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
    const center = clampFrequencyHz(txCenterHz, visibleMinHz, visibleMaxHz);
    const halfWidth = Math.max(1, txSampleRateHz / 2);
    const start = clampFrequencyHz(
      center - halfWidth,
      visibleMinHz,
      visibleMaxHz,
    );
    const end = clampFrequencyHz(
      center + halfWidth,
      visibleMinHz,
      visibleMaxHz,
    );
    const left = ((start - visibleMinHz) / span) * 100;
    const right = ((end - visibleMinHz) / span) * 100;
    return {
      left: Math.max(0, Math.min(100, left)),
      width: Math.max(
        0,
        Math.min(100, right) - Math.max(0, Math.min(100, left)),
      ),
      center: ((center - visibleMinHz) / span) * 100,
      start,
      end,
      centerHz: center,
    };
  }, [txCenterHz, txSampleRateHz, visibleMaxHz, visibleMinHz]);

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
          <Badge>{signalLabel}</Badge>
        </Header>
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
            {formatHz(txSampleRateHz)} sample rate · {formatHz(txCenterHz)}{" "}
            center · {powerDbm.toFixed(1)} dBm target
          </Hint>
        </Body>
      </OverlayCard>
    </OverlayRoot>
  );
};

export default TxSliderOverlay;

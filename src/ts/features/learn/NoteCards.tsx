import React from "react";
import styled from "styled-components";
import {
  useAppDispatch,
  useAppSelector,
  selectNoteCards,
  selectActiveNoteCard,
  setActiveNoteCard,
  updateNoteCardPosition,
  updateNoteCardSize,
  updateNoteCardText,
  selectNoteCardsCollapsed,
  setNoteCardsCollapsed,
} from "@n-apt/redux";
import { formatFrequency } from "@n-apt/math/frequency";
import { calculateCenterFrequency } from "@n-apt/math/centerFrequency";

const MIN_CARD_WIDTH = 300;
const MIN_CARD_HEIGHT = 320;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 20;
`;

const Card = styled.article<{
  $x: number;
  $y: number;
  $zIndex: number;
  $active: boolean;
  $width: number;
  $height: number;
}>`
  position: absolute;
  top: ${({ $y }) => `${$y}px`};
  left: ${({ $x }) => `${$x}px`};
  width: ${({ $width }) => `${$width}px`};
  height: ${({ $height }) => `${$height}px`};
  min-width: ${MIN_CARD_WIDTH}px;
  min-height: ${MIN_CARD_HEIGHT}px;
  border-radius: 28px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme, $active }) =>
    $active ? theme.colors.surfaceHover : theme.colors.surface};
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.34);
  color: ${({ theme }) => theme.colors.textPrimary};
  z-index: ${({ $zIndex }) => $zIndex + 5};
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  resize: both;
  box-sizing: border-box;
  max-width: min(92vw, 960px);
  max-height: min(92vh, 920px);
`;

const HandleZone = styled.button`
  border: 0;
  background: transparent;
  padding: 18px 20px 8px;
  cursor: grab;
  touch-action: none;
`;

const HandleBar = styled.div`
  width: 120px;
  height: 14px;
  border-radius: 999px;
  margin: 0 auto;
  background: ${({ theme }) => theme.colors.borderHover};
`;

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0;
  overflow: hidden;
  flex: 1;
  min-height: 0;
`;

const ScrollBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 24px 20px;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
`;

const SummaryButton = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
  white-space: pre-line;
  transition: color 0.18s ease;

  &:hover {
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const TitleInput = styled.textarea`
  width: 100%;
  min-height: fit-content;
  resize: none;
  field-sizing: content;
  border: 0;
  outline: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.sans};
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 700;
  line-height: 1.04;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
`;

const SectionTitle = styled.div`
  color: ${({ theme }) => theme.colors.metadataLabel};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px 18px;
`;

const Label = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 12px;
`;

const Value = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 12px;
  text-align: right;
`;

const formatRange = (range: { min: number; max: number } | null) => {
  if (!range) return "Unavailable";
  const min = Number.isFinite(range.min)
    ? formatFrequency(range.min, { precisionMHz: 3 })
    : "---";
  const max = Number.isFinite(range.max)
    ? formatFrequency(range.max, { precisionMHz: 3 })
    : "---";
  return `${min} - ${max}`;
};

const formatSummary = (card: ReturnType<typeof selectNoteCards>[number]) => {
  const centerFrequencyHz =
    card.stats.centerFrequencyHz ??
    calculateCenterFrequency(card.stats.frequencyRange);
  const centerText = Number.isFinite(centerFrequencyHz ?? Number.NaN)
    ? formatFrequency(centerFrequencyHz ?? 0, {
        precisionMHz: 3,
      })
    : "Unavailable";
  const zoomText = Number.isFinite(card.stats.vizZoom)
    ? card.stats.vizZoom.toFixed(1)
    : "---";
  return `${centerText}\n${zoomText}x zoom\n${card.stats.fftDbMin} to ${card.stats.fftDbMax} ${
    card.stats.powerScale === "dBm" ? "dBm" : "dB"
  }`;
};

const useCardRef = () => {
  const cardRef = React.useRef<HTMLElement | null>(null);
  return cardRef;
};

type NoteCardEntry = ReturnType<typeof selectNoteCards>[number];

interface NoteCardsProps {
  onViewNoteCard?: (card: NoteCardEntry) => void;
}

export const NoteCards: React.FC<NoteCardsProps> = ({ onViewNoteCard }) => {
  const dispatch = useAppDispatch();
  const cards = useAppSelector(selectNoteCards);
  const activeCard = useAppSelector(selectActiveNoteCard);
  const isCollapsed = useAppSelector(selectNoteCardsCollapsed);
  const didDragRef = React.useRef(false);

  const activeCardModel = React.useMemo(() => {
    if (activeCard) return activeCard;
    const explicitActive = cards.find((card) => card.isActive);
    if (explicitActive) return explicitActive;
    return cards.length ? cards[cards.length - 1] : null;
  }, [activeCard, cards]);

  const dragStateRef = React.useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pendingDragPositionRef = React.useRef<{
    id: string;
    position: { x: number; y: number };
  } | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const resizeSyncTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const cardRef = useCardRef();
  const centerFrequencyHz = activeCardModel
    ? (activeCardModel.stats.centerFrequencyHz ??
      calculateCenterFrequency(activeCardModel.stats.frequencyRange))
    : null;
  const activeCardId = activeCardModel?.id ?? null;
  const activeCardWidth = activeCardModel?.size.width ?? null;
  const activeCardHeight = activeCardModel?.size.height ?? null;

  const flushPendingUpdates = React.useCallback(() => {
    frameRef.current = null;

    const dragUpdate = pendingDragPositionRef.current;
    if (dragUpdate) {
      dispatch(
        updateNoteCardPosition({
          id: dragUpdate.id,
          position: dragUpdate.position,
        }),
      );
      pendingDragPositionRef.current = null;
    }
  }, [dispatch]);

  const scheduleFlush = React.useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = window.requestAnimationFrame(flushPendingUpdates);
  }, [flushPendingUpdates]);

  const onPointerMove = React.useCallback(
    (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      didDragRef.current = true;
      pendingDragPositionRef.current = {
        id: dragState.id,
        position: {
          x: Math.max(24, dragState.originX + event.clientX - dragState.startX),
          y: Math.max(24, dragState.originY + event.clientY - dragState.startY),
        },
      };
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const endDrag = React.useCallback(
    (event: PointerEvent) => {
      if (dragStateRef.current?.pointerId === event.pointerId) {
        dragStateRef.current = null;
        didDragRef.current = false;
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      flushPendingUpdates();
    },
    [flushPendingUpdates],
  );

  const toggleCollapsed = React.useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    dispatch(setNoteCardsCollapsed(!isCollapsed));
  }, [dispatch, isCollapsed]);

  React.useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!activeCardModel || !cardRef.current || !entry) return;

      if (resizeSyncTimeoutRef.current) {
        clearTimeout(resizeSyncTimeoutRef.current);
      }

      resizeSyncTimeoutRef.current = setTimeout(() => {
        if (!cardRef.current) return;
        const nextWidth = Math.max(
          MIN_CARD_WIDTH,
          Math.round(cardRef.current.offsetWidth),
        );
        const nextHeight = Math.max(
          MIN_CARD_HEIGHT,
          Math.round(cardRef.current.offsetHeight),
        );

        if (
          nextWidth === activeCardModel.size.width &&
          nextHeight === activeCardModel.size.height
        ) {
          return;
        }

        dispatch(
          updateNoteCardSize({
            id: activeCardModel.id,
            size: { width: nextWidth, height: nextHeight },
          }),
        );
      }, 120);
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    if (cardRef.current) {
      resizeObserver.observe(cardRef.current);
    }
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      resizeObserver.disconnect();
      if (resizeSyncTimeoutRef.current) {
        clearTimeout(resizeSyncTimeoutRef.current);
        resizeSyncTimeoutRef.current = null;
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    activeCardId,
    activeCardWidth,
    activeCardHeight,
    cardRef,
    endDrag,
    onPointerMove,
    scheduleFlush,
  ]);

  if (!activeCardModel || isCollapsed) {
    return null;
  }

  return (
    <Overlay>
      <Card
        ref={cardRef}
        key={activeCardModel.id}
        $x={activeCardModel.position.x}
        $y={activeCardModel.position.y}
        $zIndex={activeCardModel.zIndex}
        $active={true}
        $width={activeCardModel.size.width}
        $height={activeCardModel.size.height}
        onMouseDown={() => dispatch(setActiveNoteCard(activeCardModel.id))}
      >
        <HandleZone
          type="button"
          onPointerDown={(event) => {
            didDragRef.current = false;
            dragStateRef.current = {
              id: activeCardModel.id,
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: activeCardModel.position.x,
              originY: activeCardModel.position.y,
            };
            dispatch(setActiveNoteCard(activeCardModel.id));
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onClick={toggleCollapsed}
        >
          <HandleBar />
        </HandleZone>
        <Content>
          <ScrollBody>
            <TitleInput
              value={activeCardModel.title}
              name="note"
              placeholder="This looks like it's it..."
              rows={2}
              onChange={(event) =>
                dispatch(
                  updateNoteCardText({
                    id: activeCardModel.id,
                    title: event.target.value,
                  }),
                )
              }
            />

            <SummaryButton
              type="button"
              onClick={() => onViewNoteCard?.(activeCardModel)}
              aria-label="View note on FFT"
            >
              {formatSummary(activeCardModel)}
            </SummaryButton>

            <SectionTitle>Signal display</SectionTitle>
            <StatsGrid>
              <Label>Range</Label>
              <Value>{formatRange(activeCardModel.stats.frequencyRange)}</Value>
              <Label>FFT Size</Label>
              <Value>{activeCardModel.stats.fftSize}</Value>
              <Label>FFT Window</Label>
              <Value>{activeCardModel.stats.fftWindow}</Value>
              <Label>Temporal Resolution</Label>
              <Value>{activeCardModel.stats.temporalResolution}</Value>
              <Label>Power Scale</Label>
              <Value>{activeCardModel.stats.powerScale}</Value>
            </StatsGrid>

            <SectionTitle>Source settings</SectionTitle>
            <StatsGrid>
              <Label>Source Mode</Label>
              <Value>{activeCardModel.stats.sourceMode}</Value>
              <Label>Gain</Label>
              <Value>{activeCardModel.stats.gain} dB</Value>
              <Label>PPM</Label>
              <Value>{activeCardModel.stats.ppm}</Value>
              <Label>Tuner AGC</Label>
              <Value>{activeCardModel.stats.tunerAGC ? "On" : "Off"}</Value>
              <Label>RTL AGC</Label>
              <Value>{activeCardModel.stats.rtlAGC ? "On" : "Off"}</Value>
            </StatsGrid>

            <SectionTitle>Signal features</SectionTitle>
            <StatsGrid>
              <Label>Center Frequency</Label>
              <Value>
                {Number.isFinite(centerFrequencyHz ?? Number.NaN)
                  ? formatFrequency(centerFrequencyHz ?? 0, {
                      precisionMHz: 3,
                    })
                  : "Unavailable"}
              </Value>
              <Label>Sample Rate</Label>
              <Value>
                {Number.isFinite(activeCardModel.stats.sampleRateHz)
                  ? formatFrequency(activeCardModel.stats.sampleRateHz, {
                      precisionMHz: 1,
                    })
                  : "---"}
              </Value>
              <Label>Heterodyned?</Label>
              <Value>
                {activeCardModel.stats.heterodyningDetected
                  ? "Yes"
                  : activeCardModel.stats.heterodyningStatusText}
              </Value>
              <Label>Current Zoom</Label>
              <Value>
                {Number.isFinite(activeCardModel.stats.vizZoom)
                  ? activeCardModel.stats.vizZoom.toFixed(1)
                  : "---"}
                x
              </Value>
            </StatsGrid>
          </ScrollBody>
        </Content>
      </Card>
    </Overlay>
  );
};

export default NoteCards;

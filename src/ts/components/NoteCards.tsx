import React from "react";
import styled from "styled-components";
import TextareaAutosize from "react-textarea-autosize";
import type { FFTCanvasHandle } from "@n-apt/components";
import {
  useAppDispatch,
  useAppSelector,
  createNoteCardFromSpectrum,
  selectNoteCards,
  setActiveNoteCard,
  updateNoteCardPosition,
  updateNoteCardSize,
  updateNoteCardText,
  attachNoteCardSnapshot,
  hydrateNoteCards,
  setNoteCardsCollapsed,
  selectNoteCardsCollapsed,
} from "@n-apt/redux";
import { persistNoteCards, loadPersistedNoteCards } from "@n-apt/utils/noteCardStorage";

const MIN_CARD_WIDTH = 300;
const MIN_CARD_HEIGHT = 320;
const STACK_OFFSET_X = 0;
const STACK_OFFSET_Y = 0;
const STACK_EXTENSION = 60;
const COLLAPSED_CARD_HEIGHT = 96;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 20;
`;

const StackShadow = styled.div<{
  $x: number;
  $y: number;
  $width: number;
  $height: number;
  $offset: number;
}>`
  position: absolute;
  top: ${({ $y, $height }) => `${$y + $height - STACK_EXTENSION / 2}px`};
  left: ${({ $x }) => `${$x}px`};
  width: ${({ $width }) => `${$width}px`};
  height: ${STACK_EXTENSION}px;
  border-radius: 32px;
  border: 0;
  background: linear-gradient(180deg, rgba(15, 15, 15, 0.92), rgba(0, 0, 0, 0.98));
  transform: ${({ $offset }) =>
    `translate(${$offset * STACK_OFFSET_X}px, ${$offset * STACK_OFFSET_Y}px)`};
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  opacity: 1;
  z-index: 0;
  overflow: hidden;
`;

const Card = styled.article<{
  $x: number;
  $y: number;
  $zIndex: number;
  $active: boolean;
  $width: number;
  $height: number;
  $collapsed: boolean;
}>`
  position: absolute;
  top: ${({ $y }) => `${$y}px`};
  left: ${({ $x }) => `${$x}px`};
  width: ${({ $width }) => `${$width}px`};
  height: ${({ $height, $collapsed }) =>
    $collapsed ? `${Math.min($height, COLLAPSED_CARD_HEIGHT)}px` : `${$height}px`};
  min-width: ${MIN_CARD_WIDTH}px;
  min-height: ${MIN_CARD_HEIGHT}px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: ${({ $active }) => ($active ? "#4b4b4b" : "#3d3d3d")};
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.34);
  color: #fff;
  z-index: ${({ $zIndex }) => $zIndex + 5};
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: height 180ms ease;
  user-select: none;
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
  background: rgba(0, 0, 0, 0.28);
`;

const Content = styled.div<{ $collapsed: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 24px 24px;
  overflow: hidden;
  flex: 1;
  ${({ $collapsed }) => ($collapsed ? "display: none;" : "")}
`;

const ScrollBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
`;

const TitleInput = styled(TextareaAutosize)`
  width: 100%;
  min-height: 2.5rem;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: #fff;
  font-family: Inter, sans-serif;
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 700;
  line-height: 1.04;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
`;

const SnapshotImage = styled.img`
  display: block;
  width: 100%;
  height: auto;
  max-height: 140px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  object-fit: cover;
  background: #0f0f0f;
`;

const ResizeHandle = styled.button`
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  cursor: nwse-resize;
  pointer-events: auto;
  touch-action: none;
`;

const Actions = styled.div`
  display: flex;
  gap: 10px;
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  color: ${({ $primary }) => ($primary ? "#fff" : "#d6d6d6")};
  background: ${({ $primary }) => ($primary ? "#275df2" : "rgba(255,255,255,0.08)")};
`;

const Summary = styled.div`
  color: #7c7c7c;
  font-family: "JetBrains Mono", monospace;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
  white-space: pre-line;
`;

const SectionTitle = styled.div`
  color: #9a9a9a;
  font-family: "JetBrains Mono", monospace;
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
  color: #d0d0d0;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
`;

const Value = styled.div`
  color: #9b9b9b;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  text-align: right;
`;

export interface NoteCardsProps {
  fftCanvasRef?: React.RefObject<FFTCanvasHandle | null>;
}

const formatRange = (range: { min: number; max: number } | null) => {
  if (!range) return "Unavailable";
  return `${range.min.toFixed(3)}-${range.max.toFixed(3)} MHz`;
};

const formatSummary = (card: ReturnType<typeof selectNoteCards>[number]) => {
  const center = card.stats.centerFrequencyMHz;
  const centerText = center !== null ? `${center.toFixed(3)}MHz` : "Unavailable";
  return `${centerText}\n${card.stats.vizZoom.toFixed(1)}x zoom\n${card.stats.fftDbMin} to ${card.stats.fftDbMax}${card.stats.powerScale}`;
};

const useNoteCardPersistence = (
  cards: ReturnType<typeof selectNoteCards>,
  isCollapsed: boolean,
) => {
  const dispatch = useAppDispatch();
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void loadPersistedNoteCards().then((stored) => {
      if (!cancelled) {
        if (stored.cards.length > 0) {
          dispatch(hydrateNoteCards(stored.cards));
        }
        dispatch(setNoteCardsCollapsed(stored.isCollapsed));
        setIsHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  React.useEffect(() => {
    if (!isHydrated) {
      return;
    }
    void persistNoteCards({ cards, isCollapsed });
  }, [cards, isCollapsed, isHydrated]);

  return isHydrated;
};

export const NoteCards: React.FC<NoteCardsProps> = ({ fftCanvasRef }) => {
  const dispatch = useAppDispatch();
  const cards = useAppSelector(selectNoteCards);
  const isCollapsed = useAppSelector(selectNoteCardsCollapsed);
  const isHydrated = useNoteCardPersistence(cards, isCollapsed);
  const titleRef = React.useRef<HTMLTextAreaElement | null>(null);
  const didDragRef = React.useRef(false);

  const activeCard = React.useMemo(() => {
    const explicitActive = cards.find((card) => card.isActive);
    if (explicitActive) return explicitActive;
    return cards.length ? cards[cards.length - 1] : null;
  }, [cards]);

  const stackPreview = React.useMemo(() => {
    if (!activeCard) return [];
    return cards
      .filter((card) => card.id !== activeCard.id)
      .sort((a, b) => b.zIndex - a.zIndex)
      .slice(0, 2);
  }, [activeCard, cards]);

  const dragStateRef = React.useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizeStateRef = React.useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);

  const createCard = React.useCallback(() => {
    const snapshot = fftCanvasRef?.current?.getCompositeSnapshot() ?? null;
    void dispatch(createNoteCardFromSpectrum({ snapshot }));
  }, [dispatch, fftCanvasRef]);

  const adjustTitleHeight = React.useCallback(() => {
    const node = titleRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  React.useEffect(() => {
    adjustTitleHeight();
  }, [activeCard?.id, activeCard?.title, adjustTitleHeight]);

  React.useEffect(() => {
    if (isHydrated && cards.length === 0) {
      createCard();
    }
  }, [cards.length, createCard, isHydrated]);

  const onPointerMove = React.useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    didDragRef.current = true;
    dispatch(
      updateNoteCardPosition({
        id: dragState.id,
        position: {
          x: Math.max(24, dragState.originX + event.clientX - dragState.startX),
          y: Math.max(24, dragState.originY + event.clientY - dragState.startY),
        },
      }),
    );
  }, [dispatch]);

  const onResizeMove = React.useCallback((event: PointerEvent) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    dispatch(
      updateNoteCardSize({
        id: resizeState.id,
        size: {
          width: Math.max(MIN_CARD_WIDTH, resizeState.originWidth + event.clientX - resizeState.startX),
          height: Math.max(MIN_CARD_HEIGHT, resizeState.originHeight + event.clientY - resizeState.startY),
        },
      }),
    );
  }, [dispatch]);

  const endDrag = React.useCallback((event: PointerEvent) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      didDragRef.current = false;
    }
    if (resizeStateRef.current?.pointerId === event.pointerId) {
      resizeStateRef.current = null;
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    dispatch(setNoteCardsCollapsed(!isCollapsed));
  }, [dispatch, isCollapsed]);

  React.useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointermove", onResizeMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag, onPointerMove, onResizeMove]);

  if (!activeCard) {
    return null;
  }

  return (
    <Overlay>
      {stackPreview.map((card, index) => (
        <StackShadow
          key={`stack-${card.id}`}
          $x={card.position.x}
          $y={card.position.y}
          $width={card.size.width}
          $height={card.size.height}
          $offset={stackPreview.length - index}
          onClick={() => dispatch(setActiveNoteCard(card.id))}
          aria-label="Show previous note card"
        />
      ))}
      <Card
        key={activeCard.id}
        $x={activeCard.position.x}
        $y={activeCard.position.y}
        $zIndex={activeCard.zIndex}
        $active={true}
        $width={activeCard.size.width}
        $height={activeCard.size.height}
        $collapsed={isCollapsed}
        onMouseDown={() => dispatch(setActiveNoteCard(activeCard.id))}
      >
        <HandleZone
          type="button"
          onPointerDown={(event) => {
            didDragRef.current = false;
            dragStateRef.current = {
              id: activeCard.id,
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: activeCard.position.x,
              originY: activeCard.position.y,
            };
            dispatch(setActiveNoteCard(activeCard.id));
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onClick={toggleCollapsed}
        >
          <HandleBar />
        </HandleZone>
        <Content $collapsed={isCollapsed}>
          <ScrollBody>
            <TitleInput
              ref={titleRef}
              value={activeCard.title}
              name="note"
              placeholder="This looks like it's it..."
              minRows={2}
              onChange={(event) =>
                dispatch(updateNoteCardText({ id: activeCard.id, title: event.target.value }))
              }
              onInput={adjustTitleHeight}
            />

            {activeCard.snapshot?.dataUrl ? (
              <SnapshotImage
                src={activeCard.snapshot.dataUrl}
                alt="FFT snapshot"
                draggable={false}
              />
            ) : null}

            <Summary>{formatSummary(activeCard)}</Summary>

            <SectionTitle>Signal display</SectionTitle>
            <StatsGrid>
              <Label>Range</Label>
              <Value>{formatRange(activeCard.stats.frequencyRange)}</Value>
              <Label>FFT Size</Label>
              <Value>{activeCard.stats.fftSize}</Value>
              <Label>FFT Window</Label>
              <Value>{activeCard.stats.fftWindow}</Value>
              <Label>Temporal Resolution</Label>
              <Value>{activeCard.stats.temporalResolution}</Value>
              <Label>Power Scale</Label>
              <Value>{activeCard.stats.powerScale}</Value>
            </StatsGrid>

            <SectionTitle>Source settings</SectionTitle>
            <StatsGrid>
              <Label>Source Mode</Label>
              <Value>{activeCard.stats.sourceMode}</Value>
              <Label>Gain</Label>
              <Value>{activeCard.stats.gain} dB</Value>
              <Label>PPM</Label>
              <Value>{activeCard.stats.ppm}</Value>
              <Label>Tuner AGC</Label>
              <Value>{activeCard.stats.tunerAGC ? "On" : "Off"}</Value>
              <Label>RTL AGC</Label>
              <Value>{activeCard.stats.rtlAGC ? "On" : "Off"}</Value>
            </StatsGrid>

            <SectionTitle>Signal features</SectionTitle>
            <StatsGrid>
              <Label>Center Frequency</Label>
              <Value>
                {activeCard.stats.centerFrequencyMHz !== null
                  ? `${activeCard.stats.centerFrequencyMHz.toFixed(3)}MHz`
                  : "Unavailable"}
              </Value>
              <Label>Sample Rate</Label>
              <Value>{(activeCard.stats.sampleRateHz / 1_000_000).toFixed(1)} MHz</Value>
              <Label>Heterodyned?</Label>
              <Value>{activeCard.stats.heterodyningDetected ? "Yes" : activeCard.stats.heterodyningStatusText}</Value>
              <Label>Current Zoom</Label>
              <Value>{activeCard.stats.vizZoom.toFixed(1)}x</Value>
            </StatsGrid>
          </ScrollBody>

          <Actions>
            <ActionButton
              type="button"
              onClick={() => {
                const snapshot = fftCanvasRef?.current?.getCompositeSnapshot();
                if (!snapshot) return;
                dispatch(attachNoteCardSnapshot({ id: activeCard.id, snapshot }));
              }}
            >
              Snapshot
            </ActionButton>
            <ActionButton $primary={true} type="button" onClick={createCard}>
              New Note Card
            </ActionButton>
          </Actions>
        </Content>
        <ResizeHandle
          type="button"
          aria-label="Resize note card"
          onPointerDown={(event) => {
            resizeStateRef.current = {
              id: activeCard.id,
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originWidth: activeCard.size.width,
              originHeight: activeCard.size.height,
            };
            dispatch(setActiveNoteCard(activeCard.id));
            event.currentTarget.setPointerCapture(event.pointerId);
            event.stopPropagation();
          }}
        />
      </Card>
    </Overlay>
  );
};

export default NoteCards;

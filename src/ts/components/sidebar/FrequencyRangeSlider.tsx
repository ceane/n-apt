import React, { useState, useRef, useEffect, useCallback } from "react";
import styled from "styled-components";
import { FrequencyRange } from "@n-apt/hooks/useWebSocket";
import { formatFrequency } from "@n-apt/consts/sdr";
import {
  STEP_SIZE,
  RANGE_TRACK_HEIGHT,
  RANGE_TRACK_BACKGROUND,
  RANGE_TRACK_BORDER,
  RANGE_LABELS_COLOR,
  RANGE_LABELS_PADDING,
  RANGE_LABELS_FONT_SIZE,
} from "@n-apt/consts";

interface FrequencyRangeSliderProps {
  label: string;
  minFreq: number;
  maxFreq: number;
  visibleMin: number;
  visibleMax: number;
  sampleRateMHz?: number | null;
  limitMarkers?: Array<{ freq: number; label: string }>;
  isActive: boolean;
  onActivate: () => void;
  onRangeChange: (range: FrequencyRange) => void;
  isDeviceConnected?: boolean;
  externalFrequencyRange?: FrequencyRange; // Add external frequency range for VFO sync
}

// Styled Components
const SliderWrapper = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  user-select: none;
  box-sizing: border-box;
  max-width: 100%;
`;

const LabelContainer = styled.div`
  display: grid;
  align-items: center;
  justify-items: center;
  width: 32px;
`;

const Label = styled.span<{ $isActive: boolean }>`
  font-size: 24px;
  font-weight: 700;
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textSecondary)};
  transition: color 0.2s ease;
`;

const SliderContainer = styled.div<{ $isActive: boolean }>`
  user-select: none;
  outline: none;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid ${(props) => (props.$isActive ? props.theme.primary : "transparent")};
  background-color: ${(props) => (props.$isActive ? `${props.theme.primary}20` : "transparent")};
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
  box-sizing: border-box;
  min-width: 0;
`;

const RangeTrack = styled.div`
  position: relative;
  height: ${RANGE_TRACK_HEIGHT}px;
  background-color: ${RANGE_TRACK_BACKGROUND};
  border: 1px solid ${RANGE_TRACK_BORDER};
  border-radius: 4px;
  overflow: hidden;
  user-select: none;
`;

const RangeLabels = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  justify-items: end;
  align-items: center;
  padding: ${RANGE_LABELS_PADDING};
  font-size: ${RANGE_LABELS_FONT_SIZE};
  color: ${RANGE_LABELS_COLOR};
  pointer-events: none;
  user-select: none;
`;

const Marker = styled.div`
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: rgba(220, 38, 38, 0.45);
  box-shadow: 0 0 6px rgba(220, 38, 38, 0.35);
  pointer-events: none;
`;

const VisibleWindow = styled.div<{ $isActive: boolean }>`
  position: absolute;
  top: 2px;
  bottom: 2px;
  background-color: ${(props) =>
    props.$isActive ? props.theme.activeBackground : props.theme.inactiveBackground};
  border: 1px solid ${(props) => (props.$isActive ? props.theme.primary : props.theme.textMuted)};
  cursor: grab;
  display: grid;
  align-items: center;
  justify-items: center;
  user-select: none;
  box-sizing: border-box;
  min-width: min-content;
`;

const WindowLabel = styled.span<{ $isActive: boolean }>`
  font-size: 9px;
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textMuted)};
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  padding: 0 12px;
  box-sizing: content-box;
`;

const FrequencyRangeSlider: React.FC<FrequencyRangeSliderProps> = ({
  minFreq,
  maxFreq,
  visibleMin,
  visibleMax,
  label = "A",
  isActive = false,
  onActivate,
  onRangeChange,
  isDeviceConnected = true,
  externalFrequencyRange,
  sampleRateMHz = null,
  limitMarkers,
}) => {
  // Calculate window width (constant based on visible range)
  const totalRange = maxFreq - minFreq;
  // Ensure the window width doesn't exceed the sample rate
  const rateLimitedMax =
    typeof sampleRateMHz === "number" && Number.isFinite(sampleRateMHz)
      ? visibleMin + sampleRateMHz
      : visibleMax;
  const actualVisibleMax = Math.min(visibleMax, rateLimitedMax);
  const windowWidth = (actualVisibleMax - visibleMin) / totalRange;

  // Initialize windowStart from props
  const [windowStart, setWindowStart] = useState(
    (visibleMin - minFreq) / totalRange,
  );

  // Sync windowStart when visibleMin or visibleMax change (from zoom/pan)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setWindowStart((visibleMin - minFreq) / totalRange);
    }
  }, [visibleMin, minFreq, totalRange]);

  const isDraggingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef(0);
  const dragStartWindowRef = useRef(0);
  const dragStartTrackWidthRef = useRef(0);
  const dragStartThumbWidthRef = useRef(0);
  const dragStartMaxWindowStartRef = useRef(0);
  const lastNotifiedRangeRef = useRef<FrequencyRange | null>(null);
  const internalChangeIdRef = useRef(0);
  const lastNotifiedChangeIdRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const [trackWidth, setTrackWidth] = useState(1000);
  const [thumbWidth, setThumbWidth] = useState(80);

  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const updateWidths = () => {
      if (track) setTrackWidth(track.clientWidth); // Use clientWidth to prevent border overflow
      if (thumb) setThumbWidth(thumb.getBoundingClientRect().width);
    };

    const observer = new ResizeObserver(updateWidths);
    observer.observe(track);
    observer.observe(thumb);

    updateWidths();

    return () => observer.disconnect();
  }, []);

  // Sync windowStart from external state (either actual SDR tune range or visual zoom range)
  useEffect(() => {
    if (isDraggingRef.current) return;

    let desiredStart = windowStart;
    if (externalFrequencyRange) {
      desiredStart = (externalFrequencyRange.min - minFreq) / totalRange;
      lastNotifiedRangeRef.current = externalFrequencyRange;
    } else {
      desiredStart = (visibleMin - minFreq) / totalRange;
    }

    let clamped = desiredStart;
    if (windowWidth <= 1) {
      clamped = Math.max(0, Math.min(1 - windowWidth, desiredStart));
    } else {
      const overscan = windowWidth - 1;
      clamped = Math.max(-overscan, Math.min(0, desiredStart));
    }
    setWindowStart(clamped);
  }, [externalFrequencyRange, visibleMin, minFreq, totalRange, windowWidth]);

  // Handle activation: no longer forces a notification on mount/activation
  // to prevent overwriting the store with default/initial values.
  useEffect(() => {
    if (isActive) {
      // We explicitly DO NOT increment internalChangeIdRef here anymore.
      // The parent already knows our range via the global store's lastKnownRanges.
    }
  }, [isActive]);

  const maxWindowStart = 1 - windowWidth;
  let visualRatio = 0;
  if (maxWindowStart > 0) {
    visualRatio = Math.max(0, Math.min(1, windowStart / maxWindowStart));
  }

  const draggableTrackWidth = Math.max(0, trackWidth - thumbWidth);
  let thumbLeftPx = visualRatio * draggableTrackWidth;
  if (maxWindowStart <= 0) {
    thumbLeftPx = windowStart * trackWidth;
  }

  const currentMin = Math.max(minFreq, minFreq + windowStart * totalRange);
  const currentMax = Math.min(
    maxFreq,
    minFreq + (windowStart + windowWidth) * totalRange,
  );

  // Calculate label positions to avoid collision
  const calculateLabelPositions = useCallback(() => {
    const windowLeft = thumbLeftPx;
    const windowRight = thumbLeftPx + thumbWidth;

    // Calculate label positions (approximately 50px from edges for padding)
    const leftLabelEnd = 50; // Left label occupies ~0-50px
    const rightLabelStart = trackWidth - 50; // Right label occupies ~trackWidth-50 to trackWidth

    // Check if window actually overlaps with labels (more conservative buffer)
    const hideLeftLabel = windowLeft < leftLabelEnd + 10; // 10px buffer
    const hideRightLabel = windowRight > rightLabelStart - 10; // 10px buffer

    return { hideLeftLabel, hideRightLabel };
  }, [thumbLeftPx, thumbWidth, trackWidth]);

  const labelPositions = calculateLabelPositions();

  const notifyParent = useCallback(() => {
    if (isActive && onRangeChange) {
      const nextRange = { min: currentMin, max: currentMax };
      const last = lastNotifiedRangeRef.current;
      if (!last || last.min !== nextRange.min || last.max !== nextRange.max) {
        lastNotifiedRangeRef.current = nextRange;
        onRangeChange(nextRange);
      }
    }
  }, [isActive, onRangeChange, currentMin, currentMax]);

  // Notify parent during dragging for real-time updates
  useEffect(() => {
    if (internalChangeIdRef.current === lastNotifiedChangeIdRef.current) return;
    if (isActive && isDragging) {
      lastNotifiedChangeIdRef.current = internalChangeIdRef.current;
      notifyParent();
    }
  }, [windowStart, isActive, isDragging, notifyParent]);

  // Notify parent when windowStart changes via keyboard (not dragging)
  useEffect(() => {
    if (internalChangeIdRef.current === lastNotifiedChangeIdRef.current) return;
    if (isActive && !isDragging) {
      lastNotifiedChangeIdRef.current = internalChangeIdRef.current;
      notifyParent();
    }
  }, [
    windowStart,
    isActive,
    onRangeChange,
    currentMin,
    currentMax,
    isDragging,
    notifyParent,
  ]);

  const formatFreq = useCallback((freq: number) => {
    return formatFrequency(freq);
  }, []);

  const moveWindow = useCallback(
    (direction: "up" | "down") => {
      const stepPercent = STEP_SIZE / totalRange;
      internalChangeIdRef.current += 1;
      setWindowStart((prev) => {
        const newStart =
          prev + (direction === "up" ? stepPercent : -stepPercent);
        return Math.max(0, Math.min(1 - windowWidth, newStart));
      });
    },
    [totalRange, windowWidth],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;

      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl) {
        const tag = activeEl.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          activeEl.isContentEditable
        ) {
          return;
        }
      }

      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveWindow("up");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveWindow("down");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, moveWindow]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !trackRef.current) return;

      const deltaX = e.clientX - dragStartXRef.current;

      // Dead zone: ignore tiny movements (< 2px) to prevent jitter
      if (Math.abs(deltaX) < 2) return;

      // Use dimensions captured at drag start for stability
      const tw = dragStartTrackWidthRef.current;
      const thw = dragStartThumbWidthRef.current;
      const mws = dragStartMaxWindowStartRef.current;
      const draggablePixels = Math.max(1, tw - thw);

      let newStart;
      if (windowWidth <= 1) {
        const ratioDelta = deltaX / draggablePixels;
        const windowStartDelta = ratioDelta * mws;

        newStart = dragStartWindowRef.current + windowStartDelta;
        newStart = Math.max(0, Math.min(mws, newStart));
      } else {
        const ratioDelta = deltaX / tw;
        newStart = dragStartWindowRef.current + ratioDelta;
        const overscan = windowWidth - 1;
        newStart = Math.max(-overscan, Math.min(0, newStart));
      }

      internalChangeIdRef.current += 1;
      setWindowStart(newStart);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        internalChangeIdRef.current += 1;
        notifyParent();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [maxWindowStart, thumbWidth, notifyParent]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActivate?.();
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWindowRef.current = windowStart;
    // Capture dimensions at drag start for stable calculations
    dragStartTrackWidthRef.current = trackWidth;
    dragStartThumbWidthRef.current = thumbWidth;
    dragStartMaxWindowStartRef.current = maxWindowStart;
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (
      e.target === containerRef.current ||
      (e.target as HTMLElement).closest(".range-track")
    ) {
      onActivate?.();
    }
  };

  const markerList = Array.isArray(limitMarkers) ? limitMarkers : [];

  return (
    <SliderWrapper>
      <LabelContainer>
        <Label $isActive={isActive}>{label}</Label>
      </LabelContainer>
      <SliderContainer
        ref={containerRef}
        $isActive={isActive}
        onClick={handleContainerClick}
        tabIndex={0}
      >
        <RangeTrack ref={trackRef} className="range-track">
          {isDeviceConnected &&
            markerList.map((marker) => (
              <Marker
                key={marker.label}
                title={marker.label}
                style={{
                  left: `${((marker.freq - minFreq) / totalRange) * 100}%`,
                }}
              />
            ))}
          <RangeLabels>
            <span
              style={{
                visibility: labelPositions.hideLeftLabel ? "hidden" : "visible",
                justifySelf: "start",
              }}
            >
              {formatFreq(minFreq)}
            </span>
            <span
              style={{
                visibility: labelPositions.hideRightLabel
                  ? "hidden"
                  : "visible",
              }}
            >
              {formatFreq(maxFreq)}
            </span>
          </RangeLabels>
          <VisibleWindow
            ref={thumbRef}
            $isActive={isActive}
            style={{
              left: `${thumbLeftPx}px`,
              width: `${windowWidth * 100}%`,
            }}
            onMouseDown={handleMouseDown}
          >
            <WindowLabel $isActive={isActive}>
              {formatFreq(currentMin)} - {formatFreq(currentMax)}
            </WindowLabel>
          </VisibleWindow>
        </RangeTrack>
      </SliderContainer>
    </SliderWrapper>
  );
};

export default FrequencyRangeSlider;

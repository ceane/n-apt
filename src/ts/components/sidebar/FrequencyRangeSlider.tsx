import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import styled from "styled-components";
import { Lock } from "lucide-react";
import { FrequencyRange } from "@n-apt/hooks/useWebSocket";
import { formatFrequency } from "@n-apt/consts/sdr";
import {
  STEP_SIZE,
  RANGE_TRACK_HEIGHT,
  RANGE_LABELS_PADDING,
  RANGE_LABELS_FONT_SIZE,
} from "@n-apt/consts";

interface FrequencyRangeSliderProps {
  label: string;
  minFreq: number;
  maxFreq: number;
  visibleMin: number;
  visibleMax: number;
  sampleRateHz?: number | null;
  allowWideSampleRateOverscan?: boolean;
  wideSampleRateZoomThreshold?: number;
  limitMarkers?: Array<{ freq: number; label: string }>;
  isActive: boolean;
  onActivate: () => void;
  onRangeChange: (range: FrequencyRange) => void;
  isDeviceConnected?: boolean;
  externalFrequencyRange?: FrequencyRange; // Add external frequency range for VFO sync
  readOnly?: boolean; // Add read-only mode for scanning progress
  scanProgress?: number; // Scan progress for visual feedback
  scanCurrentFreq?: number; // Current scanning frequency
  disabled?: boolean; // Disable slider interaction while keeping it visible
  forceFullWidth?: boolean;
}

// Styled Components
const SliderWrapper = styled.div<{ $disabled?: boolean }>`
  display: grid;
  grid-auto-flow: column;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  user-select: none;
  box-sizing: border-box;
  max-width: 100%;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
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
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textSecondary};
  transition: color 0.2s ease;
`;

const SliderContainer = styled.div<{ $isActive: boolean; $disabled?: boolean }>`
  user-select: none;
  outline: none;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid
    ${(props) => (props.$isActive ? props.theme.primary : "transparent")};
  background-color: ${(props) =>
    props.$isActive ? `${props.theme.primary}20` : "transparent"};
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
  box-sizing: border-box;
  min-width: 0;
  touch-action: none;
`;

const RangeTrack = styled.div<{ $disabled?: boolean }>`
  position: relative;
  height: ${RANGE_TRACK_HEIGHT}px;
  background-color: ${(props) => props.theme.rangeTrackBackground};
  border: 1px solid ${(props) => props.theme.rangeTrackBorder};
  border-radius: 4px;
  overflow: hidden;
  user-select: none;
  cursor: pointer;
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
  color: ${(props) => props.theme.rangeLabels};
  pointer-events: none;
  user-select: none;
`;

const VisibleWindow = styled.div<{
  $isActive: boolean;
  $readOnly?: boolean;
  $isScanning?: boolean;
}>`
  position: absolute;
  top: 2px;
  bottom: 2px;
  background-color: ${(props) =>
    props.$isScanning
      ? `${props.theme.success}30`
      : props.$isActive
        ? props.theme.activeBackground
        : props.theme.inactiveBackground};
  border: 1px solid
    ${(props) =>
      props.$isScanning
        ? props.theme.success
        : props.$isActive
          ? props.theme.primary
          : props.theme.textMuted};
  cursor: ${(props) => (props.$readOnly ? "default" : "grab")};
  display: grid;
  align-items: center;
  justify-items: center;
  user-select: none;
  box-sizing: border-box;
  min-width: min-content;
  overflow: visible;
  will-change: transform, width;
  transition:
    background-color 0.3s ease,
    border-color 0.3s ease;
  touch-action: none;
`;

const WindowLabel = styled.span<{ $isActive: boolean }>`
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textMuted};
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  padding: 0 8px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  isDeviceConnected: _isDeviceConnected = true,
  externalFrequencyRange,
  sampleRateHz = null,
  allowWideSampleRateOverscan: _allowWideSampleRateOverscan = false,
  wideSampleRateZoomThreshold = 1.5,
  limitMarkers: _limitMarkers,
  readOnly = false,
  scanProgress = 0,
  scanCurrentFreq,
  disabled = false,
  forceFullWidth = false,
}) => {
  const totalRange = maxFreq - minFreq;
  const safeTotalRange =
    Number.isFinite(totalRange) && totalRange > 0 ? totalRange : 1;
  const requestedVisibleMin = visibleMin;
  const requestedVisibleMax = Math.max(requestedVisibleMin, visibleMax);
  const clampedVisibleMin = Math.max(
    minFreq,
    Math.min(maxFreq, requestedVisibleMin),
  );
  const rateLimitedMax =
    typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
      ? Math.min(maxFreq, clampedVisibleMin + sampleRateHz)
      : Math.min(maxFreq, requestedVisibleMax);
  const clampedVisibleMax = Math.max(clampedVisibleMin, rateLimitedMax);
  const windowWidth = Math.max(
    0,
    (clampedVisibleMax - clampedVisibleMin) / safeTotalRange,
  );

  // Initialize windowStart from props
  const [windowStart, setWindowStart] = useState(
    (clampedVisibleMin - minFreq) / safeTotalRange,
  );

  // Sync windowStart when visibleMin or visibleMax change (from zoom/pan)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setWindowStart((clampedVisibleMin - minFreq) / safeTotalRange);
    }
  }, [clampedVisibleMin, minFreq, safeTotalRange]);

  const isDraggingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const windowLabelRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef(0);
  const dragStartWindowRef = useRef(0);
  const dragStartTrackWidthRef = useRef(0);
  const dragStartThumbWidthRef = useRef(0);
  const dragStartMaxWindowStartRef = useRef(0);
  const lastNotifiedRangeRef = useRef<FrequencyRange | null>(null);
  const internalChangeIdRef = useRef(0);
  const lastNotifiedChangeIdRef = useRef(0);
  const isLeftLockedRef = useRef(false);
  const isRightLockedRef = useRef(false);
  const [isLeftLocked, setIsLeftLocked] = useState(false);
  const [isRightLocked, setIsRightLocked] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [windowLabelWidth, setWindowLabelWidth] = useState(0);

  // Calculate scan position if scanning
  const scanWindowStart =
    readOnly && scanCurrentFreq !== undefined
      ? (scanCurrentFreq - minFreq) / safeTotalRange
      : windowStart;

  const isScanning = readOnly && scanProgress > 0;

  const [trackWidth, setTrackWidth] = useState(1000);
  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const updateWidths = () => {
      // Ignore transient zero-width observer events from hidden/non-laid-out panes.
      // Collapsing to 0 breaks min-content fallback and drag pixel math.
      if (track.clientWidth > 0) setTrackWidth(track.clientWidth);
      const label = windowLabelRef.current;
      if (label) setWindowLabelWidth(label.scrollWidth);
    };

    const observer = new ResizeObserver(updateWidths);
    observer.observe(track);
    observer.observe(thumb);
    const label = windowLabelRef.current;
    if (label) observer.observe(label);

    updateWidths();

    return () => observer.disconnect();
  }, []);

  // Sync windowStart from external state (either actual SDR tune range or visual zoom range)
  useEffect(() => {
    if (isDraggingRef.current) return;

    let desiredStart = windowStart;
    if (externalFrequencyRange) {
      desiredStart = (externalFrequencyRange.min - minFreq) / safeTotalRange;
    } else {
      desiredStart = (clampedVisibleMin - minFreq) / safeTotalRange;
    }

    let clamped = desiredStart;
    if (windowWidth <= 1) {
      clamped = Math.max(0, Math.min(1 - windowWidth, desiredStart));
    } else {
      const overscan = windowWidth - 1;
      clamped = Math.max(-overscan, Math.min(0, desiredStart));
    }
    setWindowStart(clamped);
  }, [
    externalFrequencyRange,
    clampedVisibleMin,
    minFreq,
    safeTotalRange,
    windowWidth,
  ]);

  // Handle activation: no longer forces a notification on mount/activation
  // to prevent overwriting the store with default/initial values.
  useEffect(() => {
    if (isActive) {
      // We explicitly DO NOT increment internalChangeIdRef here anymore.
      // The parent already knows our range via the global store's lastKnownRanges.
    }
  }, [isActive]);

  const isWholeChannelWindow = forceFullWidth || windowWidth >= 1;
  const renderedWindowWidth = isWholeChannelWindow ? 1 : windowWidth;
  const widthPercent = Math.max(0, Math.min(100, renderedWindowWidth * 100));
  const minContentThumbWidth = Math.min(
    trackWidth,
    Math.max(0, Math.ceil(windowLabelWidth) + 16),
  );
  const renderedThumbWidth = isWholeChannelWindow
    ? trackWidth
    : Math.min(
        trackWidth,
        Math.max(minContentThumbWidth, renderedWindowWidth * trackWidth),
      );
  const logicalMaxWindowStart =
    windowWidth <= 1 ? Math.max(0, 1 - windowWidth) : 0;
  const clampedWindowStart =
    windowWidth <= 1
      ? Math.max(0, Math.min(logicalMaxWindowStart, windowStart))
      : Math.max(-(windowWidth - 1), Math.min(0, windowStart));

  const effectiveWindowStart = isScanning
    ? scanWindowStart
    : clampedWindowStart;
  const effectiveMaxWindowStart = isScanning
    ? 1 - windowWidth
    : logicalMaxWindowStart;

  const visualRatio = useMemo(() => {
    if (effectiveMaxWindowStart > 0) {
      return Math.max(
        0,
        Math.min(1, effectiveWindowStart / effectiveMaxWindowStart),
      );
    }
    return 0;
  }, [effectiveMaxWindowStart, effectiveWindowStart]);

  const draggableTrackWidth = Math.max(0, trackWidth - renderedThumbWidth);
  const thumbLeftPx = useMemo(() => {
    if (effectiveMaxWindowStart <= 0) {
      return effectiveWindowStart * trackWidth;
    }
    return visualRatio * draggableTrackWidth;
  }, [
    effectiveMaxWindowStart,
    effectiveWindowStart,
    trackWidth,
    visualRatio,
    draggableTrackWidth,
  ]);

  const labelPositions = useMemo(() => {
    const windowLeft = thumbLeftPx;
    const windowRight = thumbLeftPx + renderedThumbWidth;
    const leftLabelEnd = 50;
    const rightLabelStart = trackWidth - 50;
    const hideLeftLabel = windowLeft < leftLabelEnd + 10;
    const hideRightLabel = windowRight > rightLabelStart - 10;
    return { hideLeftLabel, hideRightLabel };
  }, [thumbLeftPx, renderedThumbWidth, trackWidth]);

  const rawCurrentMin = minFreq + windowStart * safeTotalRange;
  const currentMin = isWholeChannelWindow
    ? minFreq
    : Math.max(minFreq, rawCurrentMin);
  const rawCurrentMax = minFreq + (windowStart + windowWidth) * safeTotalRange;
  const currentMax = isWholeChannelWindow
    ? maxFreq
    : Math.min(maxFreq, rawCurrentMax);

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

  const formatFreq = useCallback(
    (freq: number) =>
      formatFrequency(freq, {
        showUnits: true,
        precisionMHz: 4,
        precisionGHz: 4,
        precisionKHz: 0,
        trimTrailingZeros: true,
      }),
    [],
  );

  const moveWindow = useCallback(
    (direction: "up" | "down") => {
      const stepPercent = STEP_SIZE / safeTotalRange;
      internalChangeIdRef.current += 1;
      setWindowStart((prev) => {
        const newStart =
          prev + (direction === "up" ? stepPercent : -stepPercent);
        if (windowWidth <= 1) {
          return Math.max(0, Math.min(1 - windowWidth, newStart));
        }
        return Math.max(-(windowWidth - 1), Math.min(0, newStart));
      });
    },
    [safeTotalRange, windowWidth],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive || readOnly || disabled) return;

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
  }, [disabled, isActive, moveWindow, readOnly]);

  useEffect(() => {
    const handleScroll = () => {
      isLeftLockedRef.current = false;
      isRightLockedRef.current = false;
      setIsLeftLocked(false);
      setIsRightLocked(false);
    };
    window.addEventListener("wheel", handleScroll);
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("wheel", handleScroll);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

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

        if (isLeftLockedRef.current && newStart > 0) {
          isLeftLockedRef.current = false;
          setIsLeftLocked(false);
        }
        if (isRightLockedRef.current && newStart < mws) {
          isRightLockedRef.current = false;
          setIsRightLocked(false);
        }

        if (newStart <= 0) {
          newStart = 0;
          if (!isLeftLockedRef.current) {
            isLeftLockedRef.current = true;
            setIsLeftLocked(true);
          }
        } else if (newStart >= mws) {
          newStart = mws;
          if (!isRightLockedRef.current) {
            isRightLockedRef.current = true;
            setIsRightLocked(true);
          }
        }
      } else {
        const ratioDelta = deltaX / tw;
        newStart = dragStartWindowRef.current + ratioDelta;
        const overscan = windowWidth - 1;

        if (isLeftLockedRef.current && newStart > -overscan) {
          isLeftLockedRef.current = false;
          setIsLeftLocked(false);
        }
        if (isRightLockedRef.current && newStart < 0) {
          isRightLockedRef.current = false;
          setIsRightLocked(false);
        }

        if (newStart <= -overscan) {
          newStart = -overscan;
          if (!isLeftLockedRef.current) {
            isLeftLockedRef.current = true;
            setIsLeftLocked(true);
          }
        } else if (newStart >= 0) {
          newStart = 0;
          if (!isRightLockedRef.current) {
            isRightLockedRef.current = true;
            setIsRightLocked(true);
          }
        }
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
  }, [windowWidth, notifyParent]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (readOnly || disabled) return; // Disable dragging in read-only/disabled mode
    e.stopPropagation();
    onActivate?.();
    isLeftLockedRef.current = false;
    isRightLockedRef.current = false;
    setIsLeftLocked(false);
    setIsRightLocked(false);
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWindowRef.current = windowStart;
    // Capture dimensions at drag start for stable calculations
    dragStartTrackWidthRef.current = trackWidth;
    dragStartThumbWidthRef.current = renderedThumbWidth;
    dragStartMaxWindowStartRef.current = logicalMaxWindowStart;
  };

  const handleTrackMouseDown = (e: React.MouseEvent) => {
    if (readOnly || disabled) return;

    if (
      e.target === thumbRef.current ||
      thumbRef.current?.contains(e.target as Node)
    ) {
      return;
    }

    handleMouseDown(e);
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (readOnly) return; // Disable clicking in read-only mode
    if (
      e.target === containerRef.current ||
      (e.target as HTMLElement).closest(".range-track")
    ) {
      onActivate?.();
    }
  };

  return (
    <SliderWrapper $disabled={disabled || readOnly}>
      <LabelContainer>
        <Label $isActive={isActive}>{label}</Label>
      </LabelContainer>
      <SliderContainer
        ref={containerRef}
        $isActive={isActive}
        $disabled={disabled || readOnly}
        onClick={handleContainerClick}
        onMouseDown={handleTrackMouseDown}
        tabIndex={0}
      >
        <RangeTrack
          ref={trackRef}
          className="range-track"
          $disabled={disabled || readOnly}
        >
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
            $readOnly={readOnly || disabled}
            $isScanning={isScanning}
            style={{
              transform: `translate3d(${thumbLeftPx}px, 0, 0)`,
              width: isWholeChannelWindow
                ? "100%"
                : widthPercent >= 100
                  ? "100%"
                  : `${widthPercent}%`,
              minWidth: isWholeChannelWindow
                ? undefined
                : `${minContentThumbWidth}px`,
              maxWidth: "100%",
            }}
            onMouseDown={handleMouseDown}
          >
            <WindowLabel ref={windowLabelRef} $isActive={isActive}>
              {isLeftLocked && <Lock size={10} style={{ marginRight: 2 }} />}
              {formatFreq(currentMin)} - {formatFreq(currentMax)}
              {isRightLocked && <Lock size={10} style={{ marginLeft: 2 }} />}
            </WindowLabel>
          </VisibleWindow>
        </RangeTrack>
      </SliderContainer>
    </SliderWrapper>
  );
};

export default FrequencyRangeSlider;

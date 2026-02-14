import React, { useState, useRef, useEffect, useCallback } from "react"
import { FrequencyRange } from "@n-apt/hooks/useWebSocket"
import {
  DEFAULT_MIN_FREQ,
  DEFAULT_MAX_FREQ,
  DEFAULT_VISIBLE_MIN,
  DEFAULT_VISIBLE_MAX,
  STEP_SIZE,
  COLORS,
  RANGE_TRACK_HEIGHT,
  RANGE_TRACK_BACKGROUND,
  RANGE_TRACK_BORDER,
  RANGE_LABELS_COLOR,
  RANGE_LABELS_PADDING,
  RANGE_LABELS_FONT_SIZE,
} from "@n-apt/consts"

interface FrequencyRangeSliderProps {
  label: string
  minFreq: number
  maxFreq: number
  visibleMin: number
  visibleMax: number
  isActive: boolean
  onActivate: () => void
  onRangeChange: (range: FrequencyRange) => void
  isDeviceConnected?: boolean
  externalFrequencyRange?: FrequencyRange // Add external frequency range for VFO sync
}

const FrequencyRangeSlider: React.FC<FrequencyRangeSliderProps> = ({
  minFreq = DEFAULT_MIN_FREQ,
  maxFreq = DEFAULT_MAX_FREQ,
  visibleMin = DEFAULT_VISIBLE_MIN,
  visibleMax = DEFAULT_VISIBLE_MAX,
  label = "A",
  isActive = false,
  onActivate,
  onRangeChange,
  isDeviceConnected = true,
  externalFrequencyRange,
}) => {
  // Calculate window width (constant based on visible range)
  const totalRange = maxFreq - minFreq
  const windowWidth = (visibleMax - visibleMin) / totalRange

  // Initialize windowStart from props
  const [windowStart, setWindowStart] = useState(
    (visibleMin - minFreq) / totalRange,
  )

  // Visual buffer for padding accommodation
  const PADDING_BUFFER = 0.03 // 3% on each side
  const visualWindowWidth = windowWidth + PADDING_BUFFER * 2
  const visualWindowStart = Math.max(
    0,
    Math.min(windowStart - PADDING_BUFFER, 1 - visualWindowWidth),
  )
  const isDraggingRef = useRef(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartXRef = useRef(0)
  const dragStartWindowRef = useRef(0)
  const lastNotifiedRangeRef = useRef<FrequencyRange | null>(null)
  // Monotonically increasing counter: bumped on internal changes (drag/keyboard),
  // NOT bumped on external sync.  The notification effects only fire when this
  // counter has changed since the last notification, which breaks the loop.
  const internalChangeIdRef = useRef(0)
  const lastNotifiedChangeIdRef = useRef(0)

  // Track if we're currently dragging to avoid external updates during drag
  const [isDragging, setIsDragging] = useState(false)

  // Sync windowStart with external frequency range (VFO changes).
  // Does NOT bump internalChangeIdRef, so the notification effects will
  // see that the counter hasn't changed and skip the callback.
  useEffect(() => {
    if (!externalFrequencyRange || isDragging) return

    const newWindowStart = (externalFrequencyRange.min - minFreq) / totalRange
    const clamped = Math.max(0, Math.min(1 - windowWidth, newWindowStart))

    setWindowStart(clamped)
    // Keep lastNotifiedRange in sync so the next *internal* change diffs correctly
    lastNotifiedRangeRef.current = externalFrequencyRange
  }, [externalFrequencyRange, isDragging, minFreq, totalRange, windowWidth])

  const currentMin = minFreq + windowStart * totalRange
  const currentMax = minFreq + (windowStart + windowWidth) * totalRange

  // Calculate label positions to avoid collision
  const calculateLabelPositions = useCallback(() => {
    const trackWidth = trackRef.current?.getBoundingClientRect().width || 400
    const windowLeft = visualWindowStart * trackWidth
    const windowRight = (visualWindowStart + visualWindowWidth) * trackWidth

    // Calculate label positions (approximately 50px from edges for padding)
    const leftLabelEnd = 50 // Left label occupies ~0-50px
    const rightLabelStart = trackWidth - 50 // Right label occupies ~trackWidth-50 to trackWidth

    // Check if window actually overlaps with labels (more conservative buffer)
    const hideLeftLabel = windowLeft < leftLabelEnd + 10 // 10px buffer
    const hideRightLabel = windowRight > rightLabelStart - 10 // 10px buffer

    return {
      hideLeftLabel,
      hideRightLabel,
    }
  }, [visualWindowStart, visualWindowWidth])

  const labelPositions = calculateLabelPositions()

  const notifyParent = useCallback(() => {
    if (isActive && onRangeChange) {
      const nextRange = { min: currentMin, max: currentMax }
      const last = lastNotifiedRangeRef.current
      if (!last || last.min !== nextRange.min || last.max !== nextRange.max) {
        lastNotifiedRangeRef.current = nextRange
        onRangeChange(nextRange)
      }
    }
  }, [isActive, onRangeChange, currentMin, currentMax])

  // Notify parent during dragging for real-time updates
  useEffect(() => {
    if (internalChangeIdRef.current === lastNotifiedChangeIdRef.current) return
    if (isActive && isDragging) {
      lastNotifiedChangeIdRef.current = internalChangeIdRef.current
      notifyParent()
    }
  }, [
    windowStart,
    isActive,
    isDragging,
    notifyParent,
  ])

  // Notify parent when windowStart changes via keyboard (not dragging)
  useEffect(() => {
    if (internalChangeIdRef.current === lastNotifiedChangeIdRef.current) return
    if (isActive && !isDragging) {
      lastNotifiedChangeIdRef.current = internalChangeIdRef.current
      notifyParent()
    }
  }, [
    windowStart,
    isActive,
    onRangeChange,
    currentMin,
    currentMax,
    isDragging,
    notifyParent,
  ])

  const formatFreq = useCallback((freq: number) => {
    if (freq < 1) {
      return `${(freq * 1000).toFixed(0)}kHz`
    }
    return `${freq.toFixed(2)}MHz`
  }, [])

  const moveWindow = useCallback(
    (direction: "up" | "down") => {
      const stepPercent = STEP_SIZE / totalRange
      internalChangeIdRef.current += 1
      setWindowStart((prev) => {
        const newStart =
          prev + (direction === "up" ? stepPercent : -stepPercent)
        return Math.max(0, Math.min(1 - windowWidth, newStart))
      })
    },
    [totalRange, windowWidth],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return

      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl) {
        const tag = activeEl.tagName
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          activeEl.isContentEditable
        ) {
          return
        }
      }

      if (e.altKey || e.ctrlKey || e.metaKey) return

      if (e.key === "ArrowUp") {
        e.preventDefault()
        moveWindow("up")
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        moveWindow("down")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isActive, moveWindow])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !trackRef.current) return

      const track = trackRef.current
      const rect = track.getBoundingClientRect()
      const deltaX = e.clientX - dragStartXRef.current
      const deltaPercent = deltaX / rect.width

      let newStart = dragStartWindowRef.current + deltaPercent
      newStart = Math.max(0, Math.min(1 - windowWidth, newStart))

      internalChangeIdRef.current += 1
      setWindowStart(newStart)
    }

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        setIsDragging(false)
        internalChangeIdRef.current += 1
        notifyParent()
      }
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [windowWidth, notifyParent])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    isDraggingRef.current = true
    setIsDragging(true)
    dragStartXRef.current = e.clientX
    dragStartWindowRef.current = windowStart
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    if (
      e.target === containerRef.current ||
      (e.target as HTMLElement).closest(".range-track")
    ) {
      onActivate?.()
    }
  }

  // Styled Components converted to inline styles
  const sliderWrapperStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "16px",
    userSelect: "none",
  }

  const labelContainerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    flexShrink: 0,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: "24px",
    fontWeight: 700,
    color: isActive ? COLORS.primary : COLORS.textSecondary,
    transition: "color 0.2s ease",
  }

  const sliderContainerStyle: React.CSSProperties = {
    flex: 1,
    userSelect: "none",
    outline: "none",
    padding: "8px",
    borderRadius: "6px",
    border: `1px solid ${isActive ? COLORS.primary : "transparent"}`,
    backgroundColor: isActive ? `${COLORS.primary}20` : "transparent",
    cursor: "pointer",
    transition: "border-color 0.2s ease, background-color 0.2s ease",
  }

  const rangeTrackStyle: React.CSSProperties = {
    position: "relative",
    height: `${RANGE_TRACK_HEIGHT}px`,
    backgroundColor: RANGE_TRACK_BACKGROUND,
    border: `1px solid ${RANGE_TRACK_BORDER}`,
    borderRadius: "4px",
    overflow: "hidden",
    userSelect: "none",
  }

  const rangeLabelsStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: RANGE_LABELS_PADDING,
    fontSize: RANGE_LABELS_FONT_SIZE,
    color: RANGE_LABELS_COLOR,
    pointerEvents: "none",
    userSelect: "none",
  }

  const limitMarkers = [
    { freq: 0.5, label: "500kHz" },
    { freq: 28.8, label: "28.8MHz" },
  ]

  const markerStyleBase: React.CSSProperties = {
    position: "absolute",
    top: "2px",
    bottom: "2px",
    width: "2px",
    background: "rgba(220, 38, 38, 0.45)",
    boxShadow: "0 0 6px rgba(220, 38, 38, 0.35)",
    pointerEvents: "none",
  }

  const visibleWindowStyle: React.CSSProperties = {
    position: "absolute",
    top: "2px",
    bottom: "2px",
    backgroundColor: isActive
      ? COLORS.activeBackground
      : COLORS.inactiveBackground,
    border: `1px solid ${isActive ? COLORS.primary : COLORS.textMuted}`,
    cursor: "grab",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
    minWidth: "80px",
    boxSizing: "border-box",
    left: `${visualWindowStart * 100}%`,
    width: `${visualWindowWidth * 100}%`,
  }

  const windowLabelStyle: React.CSSProperties = {
    fontSize: "9px",
    color: isActive ? COLORS.primary : COLORS.textMuted,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    padding: "0 12px",
    boxSizing: "content-box", // Padding adds to outside, doesn't squeeze content
  }

  return (
    <div style={sliderWrapperStyle}>
      <div style={labelContainerStyle}>
        <div style={labelStyle}>{label}</div>
      </div>
      <div
        ref={containerRef}
        style={sliderContainerStyle}
        onClick={handleContainerClick}
        tabIndex={0}
      >
        <div ref={trackRef} className="range-track" style={rangeTrackStyle}>
          {isDeviceConnected && limitMarkers.map((marker) => (
            <div
              key={marker.label}
              title={`RTL-SDR: ${marker.label}`}
              style={{
                ...markerStyleBase,
                left: `${((marker.freq - minFreq) / totalRange) * 100}%`,
              }}
            />
          ))}
          <div style={rangeLabelsStyle}>
            <span
              style={{
                visibility: labelPositions.hideLeftLabel ? "hidden" : "visible",
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
          </div>
          <div style={visibleWindowStyle} onMouseDown={handleMouseDown}>
            <div style={windowLabelStyle}>
              {formatFreq(currentMin)} - {formatFreq(currentMax)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FrequencyRangeSlider

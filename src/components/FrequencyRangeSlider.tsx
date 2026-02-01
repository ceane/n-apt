import React, { useState, useRef, useEffect, useCallback } from 'react'
import { FrequencyRange } from '../hooks/useWebSocket'

interface FrequencyRangeSliderProps {
  label: string
  minFreq: number
  maxFreq: number
  visibleMin: number
  visibleMax: number
  isActive: boolean
  onActivate: () => void
  onRangeChange: (range: FrequencyRange) => void
}

const FrequencyRangeSlider: React.FC<FrequencyRangeSliderProps> = ({
  minFreq = 0,
  maxFreq = 4.75,
  visibleMin = 0,
  visibleMax = 3.2,
  label = 'A',
  isActive = false,
  onActivate,
  onRangeChange
}) => {
  // Calculate window width (constant based on visible range)
  const totalRange = maxFreq - minFreq;
  const windowWidth = (visibleMax - visibleMin) / totalRange;
  
  // Initialize windowStart from props
  const [windowStart, setWindowStart] = useState((visibleMin - minFreq) / totalRange);
  const isDraggingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef(0);
  const dragStartWindowRef = useRef(0);
  
  // Track if we're currently dragging to avoid external updates during drag
  const [isDragging, setIsDragging] = useState(false);

  const currentMin = minFreq + windowStart * totalRange;
  const currentMax = minFreq + (windowStart + windowWidth) * totalRange;

  const notifyParent = useCallback(() => {
    if (isActive && onRangeChange) {
      onRangeChange({ min: currentMin, max: currentMax });
    }
  }, [isActive, onRangeChange, currentMin, currentMax]);

  // Notify parent during dragging for real-time updates
  useEffect(() => {
    if (isActive && onRangeChange && isDragging) {
      onRangeChange({ min: currentMin, max: currentMax });
    }
  }, [windowStart, isActive, onRangeChange, currentMin, currentMax, isDragging]);

  // Notify parent when windowStart changes via keyboard (not dragging)
  useEffect(() => {
    if (isActive && onRangeChange && !isDragging) {
      onRangeChange({ min: currentMin, max: currentMax });
    }
  }, [windowStart, isActive, onRangeChange, currentMin, currentMax, isDragging]);

  const formatFreq = useCallback((freq: number) => {
    if (freq < 1) {
      return `${(freq * 1000).toFixed(0)}kHz`;
    }
    return `${freq.toFixed(1)}MHz`;
  }, []);

  const moveWindow = useCallback((direction: 'up' | 'down') => {
    const stepSize = 0.033;
    const stepPercent = stepSize / totalRange;
    setWindowStart(prev => {
      let newStart = prev + (direction === 'up' ? stepPercent : -stepPercent);
      newStart = Math.max(0, Math.min(1 - windowWidth, newStart));
      return newStart;
    });
  }, [totalRange, windowWidth]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveWindow('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveWindow('down');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, moveWindow]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !trackRef.current) return;

      const track = trackRef.current;
      const rect = track.getBoundingClientRect();
      const deltaX = e.clientX - dragStartXRef.current;
      const deltaPercent = deltaX / rect.width;

      let newStart = dragStartWindowRef.current + deltaPercent;
      newStart = Math.max(0, Math.min(1 - windowWidth, newStart));

      setWindowStart(newStart);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        notifyParent();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [windowWidth, notifyParent]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWindowRef.current = windowStart;
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).closest('.range-track')) {
      onActivate?.();
    }
  };

  // Styled Components converted to inline styles
  const sliderWrapperStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    userSelect: 'none',
  };

  const labelContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    flexShrink: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 700,
    color: isActive ? '#00d4ff' : '#666',
    transition: 'color 0.2s ease',
  };

  const sliderContainerStyle: React.CSSProperties = {
    flex: 1,
    userSelect: 'none',
    outline: 'none',
    padding: '8px',
    borderRadius: '6px',
    border: `1px solid ${isActive ? '#00d4ff' : 'transparent'}`,
    backgroundColor: isActive ? 'rgba(0, 212, 255, 0.05)' : 'transparent',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, background-color 0.2s ease',
  };

  const rangeTrackStyle: React.CSSProperties = {
    position: 'relative',
    height: '32px',
    backgroundColor: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '4px',
    overflow: 'hidden',
    userSelect: 'none',
  };

  const rangeLabelsStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 12px',
    fontSize: '9px',
    color: '#444',
    pointerEvents: 'none',
    userSelect: 'none',
  };

  const visibleWindowStyle: React.CSSProperties = {
    position: 'absolute',
    top: '2px',
    bottom: '2px',
    backgroundColor: isActive ? 'rgba(0, 212, 255, 0.15)' : 'rgba(128, 128, 128, 0.15)',
    border: `1px solid ${isActive ? '#00d4ff' : '#808080'}`,
    borderRadius: '2px',
    cursor: 'grab',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    padding: '0 6px',
    minWidth: '80px',
    boxSizing: 'border-box',
    left: `${windowStart * 100}%`,
    width: `${windowWidth * 100}%`,
  };

  const windowLabelStyle: React.CSSProperties = {
    fontSize: '9px',
    color: isActive ? '#00d4ff' : '#808080',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    userSelect: 'none',
  };

  const rangeInfoStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '8px',
    padding: '0 4px',
    fontSize: '11px',
    userSelect: 'none',
  };

  const rangeLabelStyle: React.CSSProperties = {
    color: isActive ? '#00d4ff' : '#666',
    fontWeight: isActive ? '500' : '400',
    userSelect: 'none',
  };

  const rangeValueStyle: React.CSSProperties = {
    color: isActive ? '#00d4ff' : '#808080',
    fontWeight: '500',
    userSelect: 'none',
  };

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
          <div style={rangeLabelsStyle}>
            <span>{formatFreq(minFreq)}</span>
            <span>{formatFreq(maxFreq)}</span>
          </div>
          <div
            style={visibleWindowStyle}
            onMouseDown={handleMouseDown}
          >
            <div style={windowLabelStyle}>
              {formatFreq(currentMin)} - {formatFreq(currentMax)}
            </div>
          </div>
        </div>
        <div style={rangeInfoStyle}>
          <div style={rangeLabelStyle}>{formatFreq(minFreq)} to {formatFreq(maxFreq)}</div>
          <div style={rangeValueStyle}>{formatFreq(currentMin)} to {formatFreq(currentMax)}</div>
        </div>
      </div>
    </div>
  );
};

export default FrequencyRangeSlider

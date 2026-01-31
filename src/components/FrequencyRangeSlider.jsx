import { useState, useRef, useEffect, useCallback } from 'react';
import styled from 'styled-components';

const SliderWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  user-select: none;
`;

const LabelContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  flex-shrink: 0;
`;

const Label = styled.div`
  font-size: 24px;
  font-weight: 700;
  color: ${props => props.$active ? '#00d4ff' : '#666'};
  transition: color 0.2s ease;
`;

const SliderContainer = styled.div`
  flex: 1;
  user-select: none;
  outline: none;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid ${props => props.$active ? '#00d4ff' : 'transparent'};
  background-color: ${props => props.$active ? 'rgba(0, 212, 255, 0.05)' : 'transparent'};
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
`;

const RangeTrack = styled.div`
  position: relative;
  height: 32px;
  background-color: #0f0f0f;
  border: 1px solid #1a1a1a;
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  font-size: 9px;
  color: #444;
  pointer-events: none;
  user-select: none;
`;

const VisibleWindow = styled.div`
  position: absolute;
  top: 2px;
  bottom: 2px;
  background-color: ${props => props.$active ? 'rgba(0, 212, 255, 0.15)' : 'rgba(128, 128, 128, 0.15)'};
  border: 1px solid ${props => props.$active ? '#00d4ff' : '#808080'};
  border-radius: 2px;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  padding: 0 6px;
  min-width: 80px;
  box-sizing: border-box;

  &:active {
    cursor: grabbing;
  }
`;

const WindowLabel = styled.div`
  font-size: 9px;
  color: ${props => props.$active ? '#00d4ff' : '#808080'};
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
`;

const RangeInfo = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding: 0 4px;
  font-size: 11px;
  user-select: none;
`;

const RangeLabel = styled.div`
  color: ${props => props.$active ? '#00d4ff' : '#666'};
  font-weight: ${props => props.$active ? '500' : '400'};
  user-select: none;
`;

const RangeValue = styled.div`
  color: ${props => props.$active ? '#00d4ff' : '#808080'};
  font-weight: 500;
  user-select: none;
`;

const FrequencyRangeSlider = ({
  minFreq = 0,
  maxFreq = 4.75,
  visibleMin = 0,
  visibleMax = 3.2,
  label = 'A',
  stepSize = 0.033,
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
  const trackRef = useRef(null);
  const containerRef = useRef(null);
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

  const formatFreq = useCallback((freq) => {
    if (freq < 1) {
      return `${(freq * 1000).toFixed(0)}kHz`;
    }
    return `${freq.toFixed(1)}MHz`;
  }, []);

  const moveWindow = useCallback((direction) => {
    const stepPercent = stepSize / totalRange;
    setWindowStart(prev => {
      let newStart = prev + (direction === 'up' ? stepPercent : -stepPercent);
      newStart = Math.max(0, Math.min(1 - windowWidth, newStart));
      return newStart;
    });
  }, [stepSize, totalRange, windowWidth]);

  useEffect(() => {
    const handleKeyDown = (e) => {
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
    const handleMouseMove = (e) => {
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

  const handleMouseDown = (e) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWindowRef.current = windowStart;
  };

  const handleContainerClick = (e) => {
    if (e.target === containerRef.current || e.target.closest('.range-track')) {
      onActivate?.();
    }
  };

  return (
    <SliderWrapper>
      <LabelContainer>
        <Label $active={isActive}>{label}</Label>
      </LabelContainer>
      <SliderContainer
        ref={containerRef}
        $active={isActive}
        onClick={handleContainerClick}
        tabIndex={0}
      >
        <RangeTrack ref={trackRef} className="range-track">
          <RangeLabels>
            <span>{formatFreq(minFreq)}</span>
            <span>{formatFreq(maxFreq)}</span>
          </RangeLabels>
          <VisibleWindow
            $active={isActive}
            style={{
              left: `${windowStart * 100}%`,
              width: `${windowWidth * 100}%`
            }}
            onMouseDown={handleMouseDown}
          >
            <WindowLabel $active={isActive}>
              {formatFreq(currentMin)} - {formatFreq(currentMax)}
            </WindowLabel>
          </VisibleWindow>
        </RangeTrack>
        <RangeInfo>
          <RangeLabel $active={isActive}>{formatFreq(minFreq)} to {formatFreq(maxFreq)}</RangeLabel>
          <RangeValue $active={isActive}>{formatFreq(currentMin)} to {formatFreq(currentMax)}</RangeValue>
        </RangeInfo>
      </SliderContainer>
    </SliderWrapper>
  );
};

export default FrequencyRangeSlider;

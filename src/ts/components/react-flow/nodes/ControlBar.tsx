import React from 'react';
import styled from 'styled-components';
import { Play, Pause, RotateCcw, Maximize2 } from 'lucide-react';

const ControlBarContainer = styled.div`
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  align-items: center;
`;

const ControlButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #3a3a3a;
    border-color: #555;
  }

  &:active {
    transform: scale(0.95);
  }
`;

interface ControlBarProps {
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  onFullscreen?: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isPlaying = false,
  onPlay,
  onPause,
  onReset,
  onFullscreen
}) => {
  return (
    <ControlBarContainer>
      <ControlButton onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        {isPlaying ? 'Pause' : 'Play'}
      </ControlButton>
      
      <ControlButton onClick={onReset}>
        <RotateCcw size={12} />
        Reset
      </ControlButton>
      
      <ControlButton onClick={onFullscreen}>
        <Maximize2 size={12} />
        Fullscreen
      </ControlButton>
    </ControlBarContainer>
  );
};

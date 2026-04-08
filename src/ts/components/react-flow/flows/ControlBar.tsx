import React from 'react';
import styled from 'styled-components';
import { Play } from 'lucide-react';

const ControlBarContainer = styled.div`
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  padding: 10px;
  background: rgba(10, 10, 10, 0.78);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  z-index: 10;
`;

const PlayButton = styled.button`
  background-color: ${(props) => props.theme.primary};
  color: white;
  border: none;
  border-radius: 10px;
  padding: 12px 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s ease;
  outline: none;
  box-shadow: none;

  &:focus,
  &:focus-visible {
    outline: none;
    box-shadow: none;
  }

  &:hover {
    background-color: ${(props) => props.theme.primaryHover};
    transform: scale(1.05);
  }

  &:active {
    transform: scale(1.02);
  }
`;

interface ControlBarProps {
  onPlay?: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({ onPlay }) => {
  return (
    <ControlBarContainer>
      <PlayButton onClick={onPlay || (() => console.log('Play button clicked'))}>
        <Play size={20} />
      </PlayButton>
    </ControlBarContainer>
  );
};

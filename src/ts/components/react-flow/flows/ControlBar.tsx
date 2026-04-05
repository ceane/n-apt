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
  padding: 12px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  z-index: 10;
`;

const PlayButton = styled.button`
  background-color: ${(props) => props.theme.primary};
  color: white;
  border: none;
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => props.theme.primaryHover};
    transform: scale(1.05);
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

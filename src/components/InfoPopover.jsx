import { useState, useRef } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';

const PopoverContainer = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

const InfoIcon = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #2a2a2a;
  border: 1px solid #3a3a3a;
  color: #666;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  transition: all 0.2s ease;
  margin-left: 8px;

  &:hover {
    background-color: #00d4ff;
    border-color: #00d4ff;
    color: #000;
  }
`;

const PopoverContent = styled.div`
  position: fixed;
  width: 280px;
  padding: 16px;
  background-color: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  z-index: 9999;
  opacity: ${props => props.$visible ? 1 : 0};
  visibility: ${props => props.$visible ? 'visible' : 'hidden'};
  transition: opacity 0.2s ease, visibility 0.2s ease;
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 50%;
    transform: translateY(-50%);
    width: 0;
    height: 0;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-right: 6px solid #2a2a2a;
  }

  &::after {
    content: '';
    position: absolute;
    left: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-right: 5px solid #1a1a1a;
  }
`;

const PopoverTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 8px;
`;

const PopoverText = styled.div`
  font-size: 11px;
  color: #888;
  line-height: 1.5;
`;

const InfoPopover = ({ title = 'Information', content }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const iconRef = useRef(null);

  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPosition({
        x: rect.right + 12,
        y: rect.top + rect.height / 2
      });
    }
    setIsVisible(true);
  };

  return (
    <PopoverContainer
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsVisible(false)}
    >
      <InfoIcon ref={iconRef}>i</InfoIcon>
      {createPortal(
        <PopoverContent 
          $visible={isVisible}
          style={{
            left: position.x,
            top: position.y,
            transform: 'translateY(-50%)'
          }}
        >
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverText>{content}</PopoverText>
        </PopoverContent>,
        document.body
      )}
    </PopoverContainer>
  );
};

export default InfoPopover;

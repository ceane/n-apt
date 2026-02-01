import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { 
  POPOVER_WIDTH, 
  POPOVER_PADDING, 
  INFO_ICON_SIZE, 
  POPOVER_Z_INDEX,
  POPOVER_ICON_BACKGROUND,
  POPOVER_ICON_BORDER,
  POPOVER_ICON_COLOR,
  POPOVER_ICON_HOVER_BACKGROUND,
  POPOVER_ICON_HOVER_COLOR,
  POPOVER_BACKGROUND,
  POPOVER_BORDER,
  POPOVER_TITLE_COLOR,
  POPOVER_TEXT_COLOR
} from '../consts'

const PopoverContainer = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`

const InfoIcon = styled.div`
  width: ${INFO_ICON_SIZE}px;
  height: ${INFO_ICON_SIZE}px;
  border-radius: 50%;
  background-color: ${POPOVER_ICON_BACKGROUND};
  border: 1px solid ${POPOVER_ICON_BORDER};
  color: ${POPOVER_ICON_COLOR};
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  transition: all 0.2s ease;
  margin-left: 8px;

  &:hover {
    background-color: ${POPOVER_ICON_HOVER_BACKGROUND};
    border-color: ${POPOVER_ICON_HOVER_BACKGROUND};
    color: ${POPOVER_ICON_HOVER_COLOR};
  }
`

const PopoverContent = styled.div<{ $visible: boolean }>`
  position: fixed;
  width: ${POPOVER_WIDTH}px;
  padding: ${POPOVER_PADDING}px;
  background-color: ${POPOVER_BACKGROUND};
  border: 1px solid ${POPOVER_BORDER};
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  z-index: ${POPOVER_Z_INDEX};
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
    border-right: 6px solid ${POPOVER_BORDER};
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
    border-right: 5px solid ${POPOVER_BACKGROUND};
  }
`

const PopoverTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${POPOVER_TITLE_COLOR};
  margin-bottom: 8px;
`

const PopoverText = styled.div`
  font-size: 11px;
  color: ${POPOVER_TEXT_COLOR};
  line-height: 1.5;
`

interface InfoPopoverProps {
  title?: string
  content: string
}

const InfoPopover: React.FC<InfoPopoverProps> = ({ title = 'Information', content }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const iconRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      setPosition({
        x: rect.right + 12,
        y: rect.top + rect.height / 2
      })
    }
    setIsVisible(true)
  }

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
  )
}

export default InfoPopover

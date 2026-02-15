import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
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
  POPOVER_TEXT_COLOR,
} from "@n-apt/consts";

const PopoverContainer = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

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

  &:hover {
    background-color: ${POPOVER_ICON_HOVER_BACKGROUND};
    border-color: ${POPOVER_ICON_HOVER_BACKGROUND};
    color: ${POPOVER_ICON_HOVER_COLOR};
  }
`;

const PopoverContent = styled.div<{
  $visible: boolean;
  $placement?: "right" | "left" | "top" | "bottom";
}>`
  position: fixed;
  width: ${POPOVER_WIDTH}px;
  padding: ${POPOVER_PADDING}px;
  background-color: ${POPOVER_BACKGROUND};
  border: 1px solid ${POPOVER_BORDER};
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  z-index: ${POPOVER_Z_INDEX};
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  visibility: ${(props) => (props.$visible ? "visible" : "hidden")};
  transition: opacity 0.2s ease, visibility 0.2s ease;
  pointer-events: none;
  max-height: calc(100vh - 24px);
  overflow-y: auto;

  ${(props) =>
    props.$placement === "right" &&
    `
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
  `}

  ${(props) =>
    props.$placement === "left" &&
    `
    &::before {
      content: '';
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 6px solid ${POPOVER_BORDER};
    }

    &::after {
      content: '';
      position: absolute;
      right: -5px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-top: 5px solid transparent;
      border-bottom: 5px solid transparent;
      border-left: 5px solid ${POPOVER_BACKGROUND};
    }
  `}

  ${(props) =>
    props.$placement === "top" &&
    `
    &::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: -6px;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid ${POPOVER_BORDER};
    }

    &::after {
      content: '';
      position: absolute;
      left: 50%;
      bottom: -5px;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 5px solid ${POPOVER_BACKGROUND};
    }
  `}

  ${(props) =>
    props.$placement === "bottom" &&
    `
    &::before {
      content: '';
      position: absolute;
      left: 50%;
      top: -6px;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 6px solid ${POPOVER_BORDER};
    }

    &::after {
      content: '';
      position: absolute;
      left: 50%;
      top: -5px;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 5px solid ${POPOVER_BACKGROUND};
    }
  `}
`;

const PopoverTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${POPOVER_TITLE_COLOR};
  margin-bottom: 8px;
`;

const PopoverText = styled.div`
  font-size: 11px;
  color: ${POPOVER_TEXT_COLOR};
  line-height: 1.5;
`;

interface InfoPopoverProps {
  title?: string;
  content: string;
}

const InfoPopover = ({ title = "Information", content }: InfoPopoverProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [placement, setPlacement] = useState<"right" | "left" | "top" | "bottom">("right");
  const [popoverHeight, setPopoverHeight] = useState(120);
  const iconRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const calculatePosition = (measuredHeight?: number) => {
    if (!iconRef.current) return { x: 0, y: 0, placement: "right" as const };

    const rect = iconRef.current.getBoundingClientRect();
    const popoverWidth = POPOVER_WIDTH;
    const currentPopoverHeight = measuredHeight ?? popoverHeight;
    const popoverPadding = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default position (right of icon, vertically aligned with icon center)
    let x = rect.right + popoverPadding;
    let y = rect.top + rect.height / 2 - currentPopoverHeight / 2;
    let placement: "right" | "left" | "top" | "bottom" = "right";

    // Check if tooltip would go off the right edge
    if (x + popoverWidth > viewportWidth) {
      // Position to the left instead
      x = rect.left - popoverWidth - popoverPadding;
      placement = "left";

      // If it would go off the left edge too, position above
      if (x < 0) {
        x = rect.left + rect.width / 2 - popoverWidth / 2;
        y = rect.top - currentPopoverHeight - popoverPadding;
        placement = "top";

        // If it would go off the top, position below
        if (y < 0) {
          y = rect.bottom + popoverPadding;
          placement = "bottom";
        }
      }
    }

    // Ensure tooltip stays within viewport bounds vertically
    if (y < 0) {
      y = popoverPadding; // Align with top of viewport
    } else if (y + currentPopoverHeight > viewportHeight) {
      y = viewportHeight - currentPopoverHeight - popoverPadding; // Align with bottom of viewport
    }

    return { x, y, placement };
  };

  useLayoutEffect(() => {
    if (!isVisible) return;
    if (!popoverRef.current) return;

    const height = popoverRef.current.getBoundingClientRect().height;
    if (height > 0) {
      setPopoverHeight(height);
      const pos = calculatePosition(height);
      setPosition({ x: pos.x, y: pos.y });
      setPlacement(pos.placement);
    }
  }, [isVisible, content]);

  const handleMouseEnter = () => {
    if (!isClicked) {
      const pos = calculatePosition();
      setPosition({ x: pos.x, y: pos.y });
      setPlacement(pos.placement);
      setIsVisible(true);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isClicked) {
      const pos = calculatePosition();
      setPosition({ x: pos.x, y: pos.y });
      setPlacement(pos.placement);
      setIsClicked(true);
      setIsVisible(true);
    } else {
      setIsClicked(false);
      setIsVisible(false);
    }
  };

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (isClicked && iconRef.current && !iconRef.current.contains(e.target as Node)) {
        setIsClicked(false);
        setIsVisible(false);
      }
    };

    if (isClicked) {
      document.addEventListener("click", handleGlobalClick);
    }

    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, [isClicked]);

  return (
    <PopoverContainer
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => !isClicked && setIsVisible(false)}
      onClick={handleClick}
    >
      <InfoIcon ref={iconRef}>i</InfoIcon>
      {createPortal(
        <PopoverContent
          ref={popoverRef}
          $visible={isVisible}
          $placement={placement}
          style={{
            left: position.x,
            top: position.y,
            transform: "none",
          }}
        >
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverText dangerouslySetInnerHTML={{ __html: content }} />
        </PopoverContent>,
        document.body,
      )}
    </PopoverContainer>
  );
};

export default InfoPopover;

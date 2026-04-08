import React from "react";
import styled from "styled-components";
import { SlidersVertical } from "lucide-react";

const SidebarToggle = styled.button`
  position: sticky;
  top: ${(props) => props.theme.spacing.xxl};
  z-index: 1000;
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.primary};
  border-radius: 6px;
  padding: ${(props) => props.theme.spacing.md};
  color: ${(props) => props.theme.primary};
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  width: fit-content;
  height: fit-content;
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    font-size: 24px;
    width: 24px;
    height: 24px;
  }
`;

const CollapsedToggle = styled(SidebarToggle)`
  position: fixed;
  top: ${(props) => props.theme.spacing.xxl};
  left: ${(props) => props.theme.spacing.xxl};
  margin: 0;
  transition: opacity 0.3s ease, transform 0.3s ease;
`;

interface SidebarToggleProps {
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

interface CollapsedToggleProps {
  onClick: () => void;
}

export const SidebarToggleButton = React.forwardRef<HTMLButtonElement, SidebarToggleProps>(
  ({ onClick }, ref) => (
    <SidebarToggle ref={ref} onClick={onClick}>
      <SlidersVertical />
    </SidebarToggle>
  )
);

SidebarToggleButton.displayName = 'SidebarToggleButton';

export const CollapsedToggleButton: React.FC<CollapsedToggleProps> = ({ onClick }) => (
  <CollapsedToggle onClick={onClick}>
    <SlidersVertical />
  </CollapsedToggle>
);

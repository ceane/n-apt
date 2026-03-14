import React from "react";
import styled from "styled-components";

const ToggleContainer = styled.div<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.6 : 1)};
`;

const Switch = styled.div<{ $active: boolean }>`
  width: 32px;
  height: 18px;
  background-color: ${(props) => (props.$active ? props.theme.primary : "#333")};
  border-radius: 9px;
  position: relative;
  transition: background-color 0.2s ease;

  &::after {
    content: "";
    position: absolute;
    top: 2px;
    left: ${(props) => (props.$active ? "16px" : "2px")};
    width: 14px;
    height: 14px;
    background-color: white;
    border-radius: 50%;
    transition: left 0.2s ease;
  }
`;

const Label = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 500;
  color: #ccc;
  user-select: none;
`;

export interface ToggleProps {
  $active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  title?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  $active,
  onClick,
  disabled,
  children,
  title,
}) => {
  return (
    <ToggleContainer
      $disabled={disabled}
      onClick={() => !disabled && onClick?.()}
      title={title}
    >
      <Switch $active={$active} />
      {children && <Label>{children}</Label>}
    </ToggleContainer>
  );
};

export default Toggle;

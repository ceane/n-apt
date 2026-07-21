import React from "react";
import styled from "styled-components";

const ToggleContainer = styled.div<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.6 : 1)};
  user-select: none;
`;

const Switch = styled.div<{ $active: boolean; $hasInnerLabel?: boolean }>`
  width: ${(props) => (props.$hasInnerLabel ? "44px" : "32px")};
  height: ${(props) => (props.$hasInnerLabel ? "18px" : "18px")};
  background-color: ${(props) =>
    props.$active ? props.theme.primary : props.theme.borderHover};
  border-radius: 999px;
  position: relative;
  transition: background-color 0.2s ease;
  pointer-events: auto;
  display: flex;
  align-items: center;

  &::after {
    content: "";
    position: absolute;
    top: ${(props) => (props.$hasInnerLabel ? "2px" : "3px")};
    left: ${(props) =>
      props.$active
        ? props.$hasInnerLabel
          ? "26px"
          : "17px"
        : props.$hasInnerLabel
          ? "2px"
          : "3px"};
    width: ${(props) => (props.$hasInnerLabel ? "13px" : "12px")};
    height: ${(props) => (props.$hasInnerLabel ? "13px" : "12px")};
    background-color: white;
    border-radius: 50%;
    transition: left 0.2s ease;
    pointer-events: none;
  }
`;

const Label = styled.span`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 500;
  color: ${(props) => props.theme.textPrimary};
  user-select: none;
`;

const InnerLabel = styled.span<{ $active: boolean }>`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 7px;
  font-weight: 700;
  color: white;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  user-select: none;
  pointer-events: none;
  left: ${(props) => (props.$active ? "5px" : "auto")};
  right: ${(props) => (!props.$active ? "5px" : "auto")};
  text-transform: uppercase;
`;

const ToggleText = styled.div`
  margin-right: 8px;
`;

export interface ToggleProps {
  $active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  title?: string;
  activeLabel?: string;
  inactiveLabel?: string;
  showInnerLabel?: boolean;
  labelPosition?: "left" | "right";
}

export const Toggle: React.FC<ToggleProps> = ({
  $active,
  onClick,
  disabled,
  children,
  title,
  activeLabel,
  inactiveLabel,
  showInnerLabel,
  labelPosition = "right",
}) => {
  const handleClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onClick) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && onClick) {
        onClick();
      }
    }
  };

  const renderLabel = () => {
    return (
      <>
        {(activeLabel || inactiveLabel) && (
          <Label>{$active ? (activeLabel ?? "") : (inactiveLabel ?? "")}</Label>
        )}
        {children && <Label>{children}</Label>}
      </>
    );
  };

  return (
    <ToggleContainer
      $disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={title}
      role="switch"
      aria-checked={$active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      {labelPosition === "left" && <ToggleText>{renderLabel()}</ToggleText>}
      <Switch $active={$active} $hasInnerLabel={showInnerLabel}>
        {showInnerLabel && (
          <InnerLabel $active={$active}>{$active ? "ON" : "OFF"}</InnerLabel>
        )}
      </Switch>
      {labelPosition === "right" && renderLabel()}
    </ToggleContainer>
  );
};

export default Toggle;

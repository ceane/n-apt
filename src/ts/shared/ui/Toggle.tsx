import React from "react";
import styled from "styled-components";

const ToggleContainer = styled.button<{ $disabled?: boolean }>`
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.6 : 1)};
  user-select: none;
`;

const Switch = styled.div<{
  $active: boolean;
  $hasInnerLabel?: boolean;
  $variant?: "default" | "three-state";
  $state?: 0 | 1 | 2;
}>`
  border: 0;
  padding: 0;
  font: inherit;
  width: ${(props) =>
    props.$variant === "three-state"
      ? "96px"
      : props.$hasInnerLabel
        ? "44px"
        : "32px"};
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
    left: ${(props) => {
      if (props.$variant === "three-state") return `${10 + (props.$state ?? 0) * 32}px`;
      return props.$active
        ? props.$hasInnerLabel
          ? "26px"
          : "17px"
        : props.$hasInnerLabel
          ? "2px"
          : "3px";
    }};
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

const ThreeStateLabel = styled(InnerLabel)<{ $state: 0 | 1 | 2 }>`
  left: 0;
  right: 0;
  width: 100%;
  text-align: center;
  font-size: 9px;
  line-height: 10px;
  z-index: 0;
`;

const ThreeStateDividers = styled.span`
  position: absolute;
  inset: 0;
  pointer-events: none;

  &::before {
    content: "";
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 33.333%;
    width: 1px;
    background: rgba(0, 0, 0, 0.24);
  }

  &::after {
    content: "";
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 66.667%;
    width: 1px;
    background: rgba(0, 0, 0, 0.24);
  }
`;

const ToggleText = styled.div`
  margin-right: 8px;
`;

export interface ToggleProps {
  $active: boolean;
  onClick?: (state?: number) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  title?: string;
  "aria-label"?: string;
  activeLabel?: string;
  inactiveLabel?: string;
  showInnerLabel?: boolean;
  labelPosition?: "left" | "right";
  variant?: "default" | "three-state";
  state?: 0 | 1 | 2;
}

export const Toggle: React.FC<ToggleProps> = ({
  $active,
  onClick,
  disabled,
  children,
  title,
  "aria-label": ariaLabel,
  activeLabel,
  inactiveLabel,
  showInnerLabel,
  labelPosition = "right",
  variant = "default",
  state = $active ? 1 : 0,
}) => {
  const handleClick = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!disabled && onClick) {
      onClick();
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

  if (variant === "three-state") {
    return (
      <ToggleContainer
        as="div"
        type="button"
        $disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
      >
        {labelPosition === "left" && <ToggleText>{renderLabel()}</ToggleText>}
        <Switch
          as="button"
          type="button"
          $active={state > 0}
          $variant="three-state"
          $state={state}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={2}
          aria-valuenow={state}
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel ?? "Fast Snapshot mode"}
          onClick={(event) => {
            event.stopPropagation();
            if (!disabled) onClick?.(((state + 1) % 3) as 0 | 1 | 2);
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === "ArrowLeft") onClick?.(Math.max(0, state - 1));
            if (event.key === "ArrowRight") onClick?.(Math.min(2, state + 1));
          }}
        >
          <ThreeStateDividers />
          <ThreeStateLabel $active={state > 0} $state={state}>
            {state === 2 ? "On + Geo" : state === 1 ? "On" : "Off"}
          </ThreeStateLabel>
        </Switch>
      </ToggleContainer>
    );
  }

  return (
    <ToggleContainer
      type="button"
      $disabled={disabled}
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
      role="switch"
      aria-checked={$active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      {labelPosition === "left" && <ToggleText>{renderLabel()}</ToggleText>}
      <Switch
        $active={$active}
        $hasInnerLabel={showInnerLabel}
        $variant={variant}
        $state={state}
      >
        {showInnerLabel && (
          <InnerLabel $active={$active}>{$active ? "ON" : "OFF"}</InnerLabel>
        )}
      </Switch>
      {labelPosition === "right" && renderLabel()}
    </ToggleContainer>
  );
};

export default Toggle;

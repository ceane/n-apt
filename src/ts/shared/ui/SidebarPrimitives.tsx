import React from "react";
import type { LucideProps } from "lucide-react";
import styled, { css } from "styled-components";

export const CompactSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 0;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;
`;

export const compactSelectInteractionStyles = css`
  &:hover {
    border-color: ${(props) => props.theme.borderHover};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
  }

  option {
    background-color: ${(props) => props.theme.surface};
    color: ${(props) => props.theme.textPrimary};
    font-family: ${(props) => props.theme.typography.mono};
  }
`;

/**
 * Canonical compact settings select: boxed to its sidebar row and carrying the
 * shared hover/focus/option treatment. Sections that need more should extend
 * this and declare only their delta.
 */
export const SettingSelect = styled(CompactSelect)`
  box-sizing: border-box;
  max-width: 100%;
  ${compactSelectInteractionStyles}
`;

const LabelWithIcon = styled.span<{ $inheritLineHeight?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  ${(props) => !props.$inheritLineHeight && css`line-height: 1.2;`}

  svg {
    width: 14px;
    height: 14px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.5;
  }
`;

export const IconLabel: React.FC<{
  icon: React.ComponentType<LucideProps>;
  text: string;
  className?: string;
  $inheritLineHeight?: boolean;
}> = ({ icon: IconComponent, text, className, $inheritLineHeight }) => (
  <LabelWithIcon className={className} $inheritLineHeight={$inheritLineHeight}>
    <IconComponent size={14} strokeWidth={1.75} aria-hidden="true" />
    {text}
  </LabelWithIcon>
);

export const SectionGrid = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

export const CheckboxSwitch = styled.label<{ $disabled?: boolean }>`
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.4 : 1)};
`;

export const CheckboxSwitchInput = styled.input<{ $plainDisabled?: boolean }>`
  opacity: 0;
  width: 44px;
  height: 24px;
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  cursor: ${(props) =>
    props.disabled && !props.$plainDisabled ? "not-allowed" : "pointer"};

  &:checked + span {
    background-color: ${(props) => props.theme.primary};
  }

  &:checked + span:before {
    transform: translateX(20px);
  }

  ${(props) =>
    !props.$plainDisabled &&
    css`
      &:disabled + span {
        cursor: not-allowed;
      }
    `}
`;

export const CheckboxSwitchSlider = styled.span<{ $disabled?: boolean }>`
  position: absolute;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) => props.theme.borderHover};
  transition: 0.2s;
  border-radius: 24px;

  &:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }
`;

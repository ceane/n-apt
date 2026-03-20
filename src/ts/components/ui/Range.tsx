import React from "react";
import styled from "styled-components";
import { formatFrequency } from "@n-apt/utils/frequency";

type RangeVariant = "primary" | "secondary";

const RangeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
`;

const RangeTitle = styled.span`
  font-size: 11px;
  font-weight: 500;
  color: ${(props) => props.theme.textPrimary};
  text-transform: none;
  width: 100%;
  text-align: left;
`;

const RangeButton = styled.button<{ $active: boolean; $variant: RangeVariant }>`
  appearance: none;
  border: 1px solid
    ${({ $active, $variant, theme }) => {
    if ($active) {
      return $variant === "primary" ? theme.primary : theme.fft;
    }
    return theme.borderHover;
  }};
  background-color: ${({ $active, $variant, theme }) => {
    if ($active) {
      return $variant === "primary" ? theme.primaryAnchor : theme.activeBackground;
    }
    return theme.surface;
  }};
  color: ${(props) => props.theme.textPrimary};
  border-radius: 8px;
  padding: 10px 10px 8px;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  font-family: ${(props) => props.theme.typography.mono};
  text-align: left;
  box-sizing: border-box;

  &:hover {
    border-color: ${({ theme }) => theme.primary};
    box-shadow: 0 0 0 1px ${({ theme }) => theme.primary}33;
  }
`;

const RangeStart = styled.span`
  font-size: 11px;
  line-height: 1.1;
  color: ${(props) => props.theme.textPrimary};
`;

const RangeEnd = styled.span`
  font-size: 11px;
  line-height: 1.1;
  width: 100%;
  text-align: right;
  color: ${(props) => props.theme.textPrimary};
`;

const RangeTotal = styled.span<{ $active: boolean; $variant: RangeVariant }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  border-radius: 999px;
  background-color: ${({ $active, $variant, theme }) => {
    if (!$active) return theme.border;
    return $variant === "primary"
      ? (theme.mode === "light" ? `${theme.primary}14` : `${theme.primary}22`)
      : (theme.mode === "light" ? `${theme.fft}14` : `${theme.fft}22`);
  }};
  color: ${({ $active, $variant, theme }) => {
    if (!$active) return "transparent";
    return $variant === "primary" ? theme.primary : theme.fft;
  }};
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.2px;
  min-height: ${({ $active }) => ($active ? "20px" : "6px")};
  padding: ${({ $active }) => ($active ? "2px 8px" : "0")};
  transition: color 0.2s ease, min-height 0.2s ease, background-color 0.2s ease;
`;

export interface RangeProps {
  label: string;
  min: number;
  max: number;
  selected: boolean;
  onToggle: () => void;
  variant?: RangeVariant;
}

export const Range: React.FC<RangeProps> = ({ label, min, max, selected, onToggle, variant = "primary" }) => {
  const totalSpan = Math.max(0, max - min);

  return (
    <RangeWrapper>
      <RangeTitle>{label}</RangeTitle>
      <RangeButton type="button" onClick={onToggle} $active={selected} aria-pressed={selected} $variant={variant}>
        <RangeStart>{formatFrequency(min)}</RangeStart>
        <RangeTotal $active={selected} aria-hidden={!selected} $variant={variant}>
          {selected ? `${formatFrequency(totalSpan)} total` : null}
        </RangeTotal>
        <RangeEnd>{formatFrequency(max)}</RangeEnd>
      </RangeButton>
    </RangeWrapper>
  );
};

export default Range;

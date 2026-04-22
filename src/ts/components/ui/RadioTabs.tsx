import React from "react";
import styled from "styled-components";

type Option = { value: string; label: string };

type RadioTabsProps = {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  name?: string;
  className?: string;
  variant?: "primary" | "fft";
};

// Pill-like radio tabs with two options. Visual styling is encapsulated here to
// render a compact tab-pair without relying on the container styling.
const TabGroup = styled.div`
  display: inline-flex;
  align-items: center;
  background: ${(p) => p.theme.surface};
  border: none;
  border-radius: 999px;
  gap: 0;
`;

const TabButton = styled.button<{ $active?: boolean; $isLeft?: boolean; $variant?: "primary" | "fft" }>`
  border: none;
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
  padding: 8px 16px;
  font-family: ${(p) => p.theme.typography.mono};
  font-size: 12px;
  cursor: pointer;
  border-radius: ${(p) => (p.$isLeft ? '0' : '0')};
  border-top-left-radius:${(p) => p.$isLeft ? '999px' : '0'};
  border-bottom-left-radius:${(p) => p.$isLeft ? '999px' : '0'};
  border-top-right-radius:${(p) => p.$isLeft ? '0' : '999px'};
  border-bottom-right-radius:${(p) => p.$isLeft ? '0' : '999px'};
  white-space: nowrap;
`;

export const RadioTabs: React.FC<RadioTabsProps> = ({ value, onChange, options, className, variant }) => {
  return (
    <TabGroup className={className} role="radiogroup" aria-label="Radio tabs">
      {options.map((opt, idx) => (
        <TabButton
          key={opt.value}
          onClick={() => onChange(opt.value)}
          $active={value === opt.value}
          $isLeft={idx === 0}
          $variant={variant}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </TabButton>
      ))}
    </TabGroup>
  );
};

export default RadioTabs;

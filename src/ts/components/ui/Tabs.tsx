import React from "react";
import styled from "styled-components";

export const TabsContainer = styled.div`
  display: flex;
  background: ${(props) => props.theme.surface};
  border-radius: 6px;
  padding: 2px;
  border: 1px solid ${(props) => props.theme.border};
  width: 100%;
`;

export const TabButton = styled.button<{ $active: boolean }>`
  flex: 1;
  background: ${({ $active, theme }) => ($active ? theme.surfaceHover : "transparent")};
  color: ${({ $active, theme }) => ($active ? theme.textPrimary : theme.textSecondary)};
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:hover {
    color: ${(props) => props.theme.textPrimary};
    background: ${({ $active, theme }) => ($active ? theme.surfaceHover : theme.background)};
  }
`;

export interface TabOption {
  value: string;
  label: React.ReactNode;
}

export interface TabsProps {
  options: TabOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  options,
  value,
  onChange,
  className,
}) => (
  <TabsContainer className={className}>
    {options.map((opt) => (
      <TabButton
        key={opt.value}
        $active={value === opt.value}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </TabButton>
    ))}
  </TabsContainer>
);

export default Tabs;

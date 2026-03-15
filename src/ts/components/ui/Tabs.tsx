import React from "react";
import styled from "styled-components";

export const TabsContainer = styled.div`
  display: flex;
  background: #141414;
  border-radius: 6px;
  padding: 2px;
  border: 1px solid #1a1a1a;
  width: 100%;
`;

export const TabButton = styled.button<{ $active: boolean }>`
  flex: 1;
  background: ${({ $active }) => ($active ? "#2a2a2a" : "transparent")};
  color: ${({ $active }) => ($active ? "#fff" : "#888")};
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:hover {
    color: #fff;
    background: ${({ $active }) => ($active ? "#2a2a2a" : "#1f1f1f")};
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

import React from "react";
import styled from "styled-components";

export const CollapsibleTitleContainer = styled.button`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0 0 16px 0;
  cursor: pointer;
  text-align: left;
`;

export const CollapsibleTitleLabel = styled.span`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1;
`;

export const CollapsibleTitleToggle = styled.span`
  font-size: 12px;
  color: #555;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  justify-self: end;
  grid-column: 2;
`;

export const CollapsibleBody = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: 8px;
`;

export interface CollapsibleTitleProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}

export const CollapsibleTitle: React.FC<CollapsibleTitleProps> = ({
  label,
  isOpen,
  onToggle,
  ...props
}) => (
  <CollapsibleTitleContainer type="button" onClick={onToggle} {...props}>
    <CollapsibleTitleLabel>{label}</CollapsibleTitleLabel>
    <CollapsibleTitleToggle>{isOpen ? "-" : "+"}</CollapsibleTitleToggle>
  </CollapsibleTitleContainer>
);

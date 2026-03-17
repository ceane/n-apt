import React from "react";
import styled from "styled-components";

export const CollapsibleTitleContainer = styled.button`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  grid-column: 1 / -1;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 1.5rem 0 0.5rem 0;
  cursor: pointer;
  text-align: left;
`;

export const CollapsibleTitleLabel = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel || "#555"};
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

export const CollapsibleTitleToggle = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.primary || "#555"};
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
`;

export const CollapsibleBody = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
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

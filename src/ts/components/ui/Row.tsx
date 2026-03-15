import React from "react";
import styled from "styled-components";
import { Tooltip } from "./Tooltip";

export const RowContainer = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  gap: inherit;
  padding: 10px 0;
  background-color: #141414;
  border-radius: 6px;
  border: 1px solid #1a1a1a;
  user-select: none;
  box-sizing: border-box;
  width: 100%;
`;

export const RowLabel = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  justify-content: start;
  gap: 8px;
  font-size: 12px;
  color: #777;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  padding-left: 12px;
`;

export const RowControl = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  justify-content: end;
  min-width: 0;
  gap: 8px;
  padding-right: 12px;
`;

export interface RowProps {
  label: React.ReactNode;
  tooltip?: string;
  tooltipTitle?: string;
  children: React.ReactNode;
  className?: string;
}

export const Row: React.FC<RowProps> = ({
  label,
  tooltip,
  tooltipTitle,
  children,
  className,
}) => {
  return (
    <RowContainer className={className}>
      <RowLabel>
        {label}
        {tooltip && <Tooltip title={tooltipTitle} content={tooltip} />}
      </RowLabel>
      <RowControl>{children}</RowControl>
    </RowContainer>
  );
};

export default Row;

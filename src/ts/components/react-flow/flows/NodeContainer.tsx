import React from "react";
import styled from "styled-components";

const NodeContainerWrapper = styled.div<{ $width?: string }>`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: ${({ theme }) => theme.spacing.lg};
  min-width: ${({ $width }) => $width || "280px"};
  font-family: ${({ theme }) => theme.typography.sans};
  box-shadow: none;
  transition:
    border-color 0.2s ease-in-out,
    background-color 0.2s ease-in-out;
  position: relative;
  overflow: visible;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    box-shadow: none;
  }

  /* Cleanup as requested by user */
`;

interface NodeContainerProps {
  children: React.ReactNode;
  "data-nodeid"?: string;
  width?: string;
  className?: string;
}

export const NodeContainer: React.FC<NodeContainerProps> = ({
  children,
  width,
  ...props
}) => {
  return (
    <NodeContainerWrapper $width={width} {...props}>
      {children}
    </NodeContainerWrapper>
  );
};

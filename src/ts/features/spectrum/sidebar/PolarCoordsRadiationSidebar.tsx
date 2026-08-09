import React from "react";
import styled from "styled-components";

const Wrap = styled.div`
  height: 100%;
  min-height: 0;
  padding: 24px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const EmptyState = styled.div`
  width: 100%;
  min-height: 220px;
  border-radius: 12px;
  border: 1px dashed ${(props) => props.theme.border};
  background: ${(props) => props.theme.surfaceHover}40;
  color: ${(props) => props.theme.textMuted};
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  font-size: 12px;
  line-height: 1.5;
`;

export const PolarCoordsRadiationSidebar: React.FC = () => {
  return (
    <Wrap>
      <EmptyState>
        Polar radiation coordinates and radiation lobe controls will live here.
      </EmptyState>
    </Wrap>
  );
};

export default PolarCoordsRadiationSidebar;

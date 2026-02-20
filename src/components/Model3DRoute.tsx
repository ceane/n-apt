import React from "react";
import styled from "styled-components";
import { HumanModelViewerSimple } from "@n-apt/components/HumanModelViewerSimple";
import { useModel3D } from "@n-apt/hooks/useModel3D";

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  margin: 0;
`;

export const Model3DRoute: React.FC = () => {
  const { selectedArea, controlsRef } = useModel3D();

  return (
    <MainContent>
      <HumanModelViewerSimple selectedArea={selectedArea} controlsRef={controlsRef} />
    </MainContent>
  );
};

import React from "react";
import styled from "styled-components";
import HumanModelViewer from "@n-apt/components/HumanModelViewer";

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

export const Model3DRoute: React.FC = () => {
  return (
    <MainContent style={{ padding: 0, margin: 0 }}>
      <HumanModelViewer />
    </MainContent>
  );
};

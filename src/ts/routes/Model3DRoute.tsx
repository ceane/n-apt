import React from "react";
import { HumanModelViewerSimple } from "@n-apt/components/HumanModelViewerSimple";
import { useModel3D } from "@n-apt/hooks/useModel3D";
import { MainContent } from "@n-apt/components/Layout";

export const Model3DRoute: React.FC = () => {
  const { selectedArea, controlsRef } = useModel3D();

  return (
    <MainContent>
      <HumanModelViewerSimple selectedArea={selectedArea} controlsRef={controlsRef} />
    </MainContent>
  );
};

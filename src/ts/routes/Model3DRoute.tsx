import React from "react";
import { Model3DCanvas } from "@n-apt/components/3D/Model3DCanvas";
import { MainContent } from "@n-apt/components/Layout";

export const Model3DRoute: React.FC = () => {
  return (
    <MainContent data-testid="model3d-route">
      <Model3DCanvas />
    </MainContent>
  );
};

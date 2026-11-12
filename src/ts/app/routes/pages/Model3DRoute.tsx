import React from "react";
import { Model3DPerson } from "@n-apt/three-d/Model3DPerson";
import { MainContent } from "@n-apt/app/Layout";
import { useModel3D } from "@n-apt/three-d/hooks/useModel3D";

export const Model3DRoute: React.FC = () => {
  const { modelVariant } = useModel3D();

  return (
    <MainContent data-testid="model3d-route">
      <Model3DPerson
        anatomyView={modelVariant === "anatomy" || modelVariant === "brain"}
        brainFocused={modelVariant === "brain"}
      />
    </MainContent>
  );
};

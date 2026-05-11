import React from "react";
import { Model3DPerson } from "@n-apt/components/3D/Model3DPerson";
import { Model3DBrain } from "@n-apt/components/3D/Model3DBrain";
import { MainContent } from "@n-apt/components/Layout";
import { useModel3D } from "@n-apt/hooks/useModel3D";

export const Model3DRoute: React.FC = () => {
  const { modelVariant } = useModel3D();

  return (
    <MainContent data-testid="model3d-route">
      {modelVariant === "brain" ? <Model3DBrain /> : <Model3DPerson />}
    </MainContent>
  );
};

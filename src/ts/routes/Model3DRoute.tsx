import React from "react";
import { HumanModelCanvas } from "@n-apt/components/3D/HumanModelCanvas";
import { MainContent } from "@n-apt/components/Layout";

export const Model3DRoute: React.FC = () => {
  return (
    <MainContent>
      <HumanModelCanvas />
    </MainContent>
  );
};

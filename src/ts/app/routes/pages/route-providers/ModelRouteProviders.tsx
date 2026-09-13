import React from "react";
import { Model3DProvider } from "@n-apt/three-d/hooks/useModel3D";
import { Model3DInteractionProvider as HotspotEditorProvider } from "@n-apt/three-d/hooks/useHotspotEditor";

export const ModelRouteProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Model3DProvider>
    <HotspotEditorProvider>{children}</HotspotEditorProvider>
  </Model3DProvider>
);

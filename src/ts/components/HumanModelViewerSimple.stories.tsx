import React from "react";
import { HumanModelViewerSimple } from "./HumanModelViewerSimple";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";

const MockWrapper = () => {
  const controlsRef = React.useRef(null);
  return (
    <div style={{ width: "100%", height: "600px", background: "#050505" }}>
      <HumanModelViewerSimple 
        selectedArea={null} 
        controlsRef={controlsRef} 
      />
    </div>
  );
};

export const Default = () => (
  <Model3DProvider>
    <MockWrapper />
  </Model3DProvider>
);

import React from "react";
import { Model3DViewerSimple } from "@n-apt/components/Model3DViewerSimple";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";

const MockWrapper = () => {
  const controlsRef = React.useRef(null);
  return (
    <div style={{ width: "100%", height: "600px", background: "#050505" }}>
      <Model3DViewerSimple
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

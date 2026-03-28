import React from "react";
import { AppRoutes } from "@n-apt/routes/Routes";

const FullscreenStage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      minHeight: "100vh",
      width: "100%",
      backgroundColor: "#050505",
      display: "flex",
      flexDirection: "column",
    }}
  >
    {children}
  </div>
);

const RoutesStory: React.FC = () => (
  <FullscreenStage>
    <AppRoutes />
  </FullscreenStage>
);

export default {
  title: "Routes/Routes",
  parameters: {
    layout: "fullscreen",
  },
};

export const VisualizerRoute = () => <RoutesStory />;

export const DemodulateRoute = () => <RoutesStory />;

export const DrawSignalRoute = () => <RoutesStory />;

export const Model3DRoute = () => <RoutesStory />;

export const MapEndpointsRoute = () => <RoutesStory />;

export const StitchTestRoute = () => <RoutesStory />;

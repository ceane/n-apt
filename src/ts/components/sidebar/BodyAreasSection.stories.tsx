import { BodyAreasSection } from "@n-apt/components/sidebar/BodyAreasSection";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { ThemeProvider } from "styled-components";

const theme = {
  primary: "#00d4ff",
  primaryAlpha: "rgba(0, 212, 255, 0.2)",
  fft: "#00d4ff",
  mode: "dark",
};

export const Default = () => (
  <ThemeProvider theme={theme as any}>
    <Model3DProvider>
      <div style={{ padding: "20px", background: "#0a0a0a", width: "350px", height: "500px", display: "flex", flexDirection: "column" }}>
        <BodyAreasSection />
      </div>
    </Model3DProvider>
  </ThemeProvider>
);

export default {
  title: 'Sidebar/Body Areas',
};

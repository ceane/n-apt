import { HotspotEditorSection } from "@n-apt/components/sidebar/HotspotEditorSection";
import { Model3DInteractionProvider } from "@n-apt/hooks/useHotspotEditor";
import { ThemeProvider } from "styled-components";

const theme = {
  primary: "#00d4ff",
  fft: "#00d4ff",
  mode: "dark",
};

export const Default = () => (
  <ThemeProvider theme={theme}>
    <div style={{ padding: "20px", background: "#0a0a0a", width: "350px", display: "grid", gap: "2px" }}>
      <Model3DInteractionProvider>
        <HotspotEditorSection />
      </Model3DInteractionProvider>
    </div>
  </ThemeProvider>
);

export default {
  title: 'Sidebar/Hotspot Editor',
};

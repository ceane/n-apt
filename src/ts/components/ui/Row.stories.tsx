import { Row, Toggle } from "@n-apt/components/ui";
import { ThemeProvider } from "styled-components";
import type { AppStyledTheme } from "@n-apt/components/ui";
import { THEME_TOKENS } from "@n-apt/consts/theme";

const theme: AppStyledTheme = {
  primary: "#00d4ff",
  danger: "#ff4444",
  surface: "#1a1a1a",
  border: "#2a2a2a",
  mode: "dark",
  requestedMode: "dark",
  waterfallTheme: "default",
  colors: {
    ...THEME_TOKENS.colors.dark,
    primary: "#00d4ff",
  },
  typography: THEME_TOKENS.typography,
  spacing: THEME_TOKENS.spacing,
  layout: THEME_TOKENS.layout,
  primaryAlpha: "#00d4ff33",
  primaryAnchor: "#00d4ff1a",
  fft: "#00d4ff",
  cssVariables: {},
};

export const Default = () => (
  <ThemeProvider theme={theme}>
    <div style={{ padding: "20px", background: "#0a0a0a", width: "350px", display: "grid", gap: "2px" }}>
      <Row label="Enable GPU" tooltip="Use WebGPU for rendering if available.">
        <Toggle $active={true}>ON</Toggle>
      </Row>
      <Row label="Smoothing" tooltip="Apply EMA smoothing to the FFT.">
        <Toggle $active={false}>OFF</Toggle>
      </Row>
    </div>
  </ThemeProvider>
);

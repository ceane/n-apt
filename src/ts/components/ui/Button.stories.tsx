import { Button } from "@n-apt/components/ui";
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
    primary: "#00d4ff",
    danger: "#ff4444",
    surface: "#1a1a1a",
    border: "#2a2a2a",
  },
  typography: {
    ...THEME_TOKENS.typography,
  },
  spacing: THEME_TOKENS.spacing,
  layout: THEME_TOKENS.layout,
  primaryAlpha: "#00d4ff33",
  primaryAnchor: "#00d4ff1a",
  fft: "#00d4ff",
  metadataLabel: "#888888",
  cssVariables: {},
};

export const Variants = () => (
  <ThemeProvider theme={theme}>
    <div style={{ display: "flex", gap: "10px", padding: "20px", background: "#0a0a0a" }}>
      <Button $variant="primary">Primary Button</Button>
      <Button $variant="secondary">Secondary Button</Button>
      <Button $variant="danger">Danger Button</Button>
    </div>
  </ThemeProvider>
);

export const Disabled = () => (
  <ThemeProvider theme={theme}>
    <div style={{ display: "flex", gap: "10px", padding: "20px", background: "#0a0a0a" }}>
      <Button $variant="primary" disabled>Primary Disabled</Button>
      <Button $variant="secondary" disabled>Secondary Disabled</Button>
      <Button $variant="danger" disabled>Danger Disabled</Button>
    </div>
  </ThemeProvider>
);

export const Loading = () => (
  <ThemeProvider theme={theme}>
    <div style={{ display: "flex", gap: "10px", padding: "20px", background: "#0a0a0a" }}>
      <Button $variant="primary">
        <span className="animate-spin">↻</span> Loading...
      </Button>
    </div>
  </ThemeProvider>
);

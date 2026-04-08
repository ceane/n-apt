import React from "react";
import { Toggle } from "@n-apt/components/ui";
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

export const States = () => (
  <ThemeProvider theme={theme}>
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px", background: "#0a0a0a", width: "300px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ width: "80px" }}>
          <Toggle $active={true}>Active</Toggle>
        </div>
        <div style={{ width: "80px" }}>
          <Toggle $active={false}>Inactive</Toggle>
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ width: "80px" }}>
          <Toggle $active={true} disabled>Active Dis</Toggle>
        </div>
        <div style={{ width: "80px" }}>
          <Toggle $active={false} disabled>Inact Dis</Toggle>
        </div>
      </div>
    </div>
  </ThemeProvider>
);

export const Interactive = () => {
  const [active, setActive] = React.useState(false);
  return (
    <ThemeProvider theme={theme}>
      <div style={{ padding: "20px", background: "#0a0a0a", width: "120px" }}>
        <Toggle $active={active} onClick={() => setActive(!active)}>
          {active ? "ENABLED" : "DISABLED"}
        </Toggle>
      </div>
    </ThemeProvider>
  );
};

export default {
  title: "Toggle",
};

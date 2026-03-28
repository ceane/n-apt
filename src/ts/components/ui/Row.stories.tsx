import React from "react";
import { Row, Toggle } from "@n-apt/components/ui";
import { ThemeProvider } from "styled-components";

const theme = {
  primary: "#00d4ff",
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

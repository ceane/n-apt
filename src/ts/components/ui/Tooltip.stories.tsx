import React from "react";
import Tooltip from "@n-apt/components/ui/Tooltip";

export const Default = () => (
  <div style={{ padding: "100px", background: "#0a0a0a", display: "flex", alignItems: "center", gap: "10px" }}>
    <span style={{ color: "#fff" }}>Hover the icon</span>
    <Tooltip
      title="Sample Rate"
      content="The rate at which the hardware samples the signal, measured in Hz. Higher rates provide more bandwidth."
    />
  </div>
);

export const LongContent = () => (
  <div style={{ padding: "100px", background: "#0a0a0a", display: "flex", alignItems: "center", gap: "10px" }}>
    <span style={{ color: "#fff" }}>More info</span>
    <Tooltip
      title="Advanced Signal Processing"
      content="EMA (Exponential Moving Average) is used to smooth the data over time. <br/><br/>This helps in visualizing weak signals that might otherwise be masked by noise floor fluctuations."
    />
  </div>
);

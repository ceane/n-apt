import React from "react";
import { createPlugin, Components } from "leva/plugin";

const GainScaleComponent = () => {
  const { Row } = Components;

  return (
    <Row input style={{ padding: "8px 0", flexDirection: "column", alignItems: "stretch", width: "100%", gap: "8px" }}>
      <div
        style={{
          fontSize: "10px",
          color: "#ccc",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        ANTENNA GAIN
      </div>
      <div
        style={{
          height: "12px",
          width: "100%",
          background:
            "linear-gradient(to right, rgb(0, 115, 255), rgb(115, 230, 215), rgb(255, 89, 166))",
          borderRadius: "3px",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "9px",
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        <span>Weaker</span>
        <span>Stronger</span>
      </div>
    </Row>
  );
};

export const levaGainScale = createPlugin({
  component: GainScaleComponent,
  normalize: () => {
    return { value: null };
  },
});

import React from "react";
import { createPlugin, Components } from "leva/plugin";

const GainScaleComponent = () => {
  const { Row } = Components;

  return (
    <Row input style={{ padding: "8px 0" }}>
      <div
        style={{
          fontSize: "10px",
          color: "#ccc",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "1px",
          display: "flex",
          alignItems: "center",
          height: "100%",
        }}
      >
        ANTENNA GAIN
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", justifyContent: "center" }}>
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
            padding: "0 2px",
          }}
        >
          <span>Weaker</span>
          <span>Stronger</span>
        </div>
      </div>
    </Row>
  );
};

const isDev = typeof window !== "undefined";

export const levaGainScale: any =
  isDev && (window as any).__LEVA_GAIN_SCALE_PLUGIN__
    ? (window as any).__LEVA_GAIN_SCALE_PLUGIN__
    : (() => {
        const plugin = createPlugin({
          component: GainScaleComponent,
          normalize: () => {
            return { value: null };
          },
        });
        if (isDev) {
          (window as any).__LEVA_GAIN_SCALE_PLUGIN__ = plugin;
        }
        return plugin;
      })();

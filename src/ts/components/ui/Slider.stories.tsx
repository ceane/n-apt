import React from "react";
import Slider from "./Slider";

export const Horizontal = () => {
  const [value, setValue] = React.useState(50);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a", width: "400px" }}>
      <Slider
        label="Volume"
        value={value}
        min={0}
        max={100}
        onChange={setValue}
        formatValue={(v) => `${v.toFixed(0)}%`}
      />
    </div>
  );
};

export const Vertical = () => {
  const [value, setValue] = React.useState(30);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a", height: "300px", display: "flex" }}>
      <Slider
        label="Gain"
        value={value}
        min={0}
        max={60}
        orientation="vertical"
        onChange={setValue}
        formatValue={(v) => `${v.toFixed(1)} dB`}
      />
    </div>
  );
};

export const WithSnapRanges = () => {
  const [value, setValue] = React.useState(100);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a", width: "500px" }}>
      <Slider
        label="Frequency"
        value={value}
        min={88}
        max={108}
        onChange={setValue}
        snapRanges={[
          { label: "Station A", min: 92, max: 94, color: "rgba(0, 212, 255, 0.2)" },
          { label: "Station B", min: 100, max: 102, color: "rgba(255, 0, 136, 0.2)" },
        ]}
      />
    </div>
  );
};

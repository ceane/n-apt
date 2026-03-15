import React from "react";
import Checkbox from "./Checkbox";

export const Default = () => {
  const [checked, setChecked] = React.useState(false);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a" }}>
      <Checkbox
        label="Accept Terms"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
      />
    </div>
  );
};

export const States = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "20px", background: "#0a0a0a" }}>
    <Checkbox label="Checked" checked={true} readOnly />
    <Checkbox label="Unchecked" checked={false} readOnly />
    <Checkbox label="Disabled Checked" checked={true} disabled />
    <Checkbox label="Disabled Unchecked" checked={false} disabled />
  </div>
);

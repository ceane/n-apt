import React from "react";
import { Tabs } from "@n-apt/components/ui";

export const Default = () => {
  const [value, setValue] = React.useState("tab1");
  return (
    <div style={{ padding: "20px", background: "#0a0a0a", width: "300px" }}>
      <Tabs
        value={value}
        onChange={setValue}
        options={[
          { value: "tab1", label: "Tab One" },
          { value: "tab2", label: "Tab Two" },
          { value: "tab3", label: "Tab Three" },
        ]}
      />
    </div>
  );
};

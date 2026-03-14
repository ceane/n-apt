import React from "react";
import { CollapsibleTitle, CollapsibleBody } from "./Collapsible";

export const Default = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a", width: "300px" }}>
      <CollapsibleTitle
        label="Advanced Settings"
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
      />
      {isOpen && (
        <CollapsibleBody>
          <div style={{ color: "#888", fontSize: "12px", padding: "10px" }}>
            This is the content inside the collapsible section.
          </div>
        </CollapsibleBody>
      )}
    </div>
  );
};

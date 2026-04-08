import { Collapsible } from "@n-apt/components/ui";

export const Default = () => {
  return (
    <div style={{ padding: "20px", background: "#0a0a0a", width: "300px" }}>
      <Collapsible title="Advanced Settings" defaultOpen={false}>
        <div style={{ color: "#888", fontSize: "12px", padding: "10px" }}>
          This is the content inside the collapsible section.
        </div>
      </Collapsible>
    </div>
  );
};

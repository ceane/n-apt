import React from "react";
import { Prompt } from "./Prompt";

export const Info = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a" }}>
      <button onClick={() => setOpen(true)}>Open Prompt</button>
      <Prompt
        open={open}
        title="Update Available"
        message="A new version of N-APT is available. Would you like to update now?"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
};

export const Danger = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div style={{ padding: "20px", background: "#0a0a0a" }}>
      <button onClick={() => setOpen(true)}>Open Danger Prompt</button>
      <Prompt
        open={open}
        variant="danger"
        title="Delete All Data"
        message="This action cannot be undone. Are you sure you want to proceed?"
        confirmText="Delete Everything"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
};

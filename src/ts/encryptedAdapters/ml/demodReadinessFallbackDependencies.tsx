import React from "react";

const UnavailableWorkflow = ({ label }: { label: string }) => (
  <div role="alert">The encrypted {label} workflow is unavailable.</div>
);

export const AudioDemodWorkflowFlow: React.FC = () => (
  <UnavailableWorkflow label="audio demodulation" />
);

export const VisionDemodWorkflowFlow: React.FC = () => (
  <UnavailableWorkflow label="vision demodulation" />
);

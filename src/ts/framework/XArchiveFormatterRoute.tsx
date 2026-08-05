import React from "react";
import { NsaProgramToolsShell } from "@n-apt/legal-app/NsaProgramToolsShell";
import TranscriptFixerRoute from "@n-apt/legal-app/routes/TranscriptFixerRoute";

export default function FrameworkXArchiveFormatterRoute() {
  return (
    <NsaProgramToolsShell>
      <TranscriptFixerRoute />
    </NsaProgramToolsShell>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

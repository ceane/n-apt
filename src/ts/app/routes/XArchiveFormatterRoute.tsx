import React from "react";
import { NsaProgramToolsShell } from "@n-apt/app-legal/NsaProgramToolsShell";
import TranscriptFixerRoute from "@n-apt/app-legal/routes/TranscriptFixerRoute";

export default function FrameworkXArchiveFormatterRoute() {
  return (
    <NsaProgramToolsShell>
      <TranscriptFixerRoute />
    </NsaProgramToolsShell>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";

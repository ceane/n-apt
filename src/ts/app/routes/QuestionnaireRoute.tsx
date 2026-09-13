import React from "react";
import { NsaProgramToolsShell } from "@n-apt/app-legal/NsaProgramToolsShell";
import QuestionnaireRoute from "@n-apt/app-legal/routes/QuestionnaireRoute";

export default function FrameworkQuestionnaireRoute() {
  return (
    <NsaProgramToolsShell>
      <QuestionnaireRoute />
    </NsaProgramToolsShell>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";

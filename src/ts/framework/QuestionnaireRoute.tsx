import React from "react";
import { NsaProgramToolsShell } from "@n-apt/legal-app/NsaProgramToolsShell";
import QuestionnaireRoute from "@n-apt/legal-app/routes/QuestionnaireRoute";

export default function FrameworkQuestionnaireRoute() {
  return (
    <NsaProgramToolsShell>
      <QuestionnaireRoute />
    </NsaProgramToolsShell>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

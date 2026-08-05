import React from "react";
import { LearnSignalsProvider } from "@n-apt/contexts/LearnSignalsContext";
import { LearnSignalsRoute as LearnSignalsPage } from "@n-apt/routes/LearnSignalsRoute";

export default function FrameworkLearnSignalsRoute() {
  return (
    <LearnSignalsProvider>
      <LearnSignalsPage />
    </LearnSignalsProvider>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

import React from "react";
import { LearnSignalsProvider } from "@n-apt/learn/public/context/LearnSignalsContext";
import { LearnSignalsRoute as LearnSignalsPage } from "@n-apt/app/routes/pages/LearnSignalsRoute";

export default function FrameworkLearnSignalsRoute() {
  return (
    <LearnSignalsProvider>
      <LearnSignalsPage />
    </LearnSignalsProvider>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";

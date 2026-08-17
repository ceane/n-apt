import React from "react";
import { SourceInventoryBoundary } from "@n-apt/app/SourceInventoryBoundary";
import GetStartedRoute from "@n-apt/app/routes/pages/GetStartedRoute";

export default function FrameworkGetStartedRoute() {
  return (
    <SourceInventoryBoundary>
      <GetStartedRoute />
    </SourceInventoryBoundary>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";

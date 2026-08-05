import React from "react";
import GetStartedRoute from "@n-apt/routes/GetStartedRoute";

export default function FrameworkGetStartedRoute() {
  return <GetStartedRoute />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

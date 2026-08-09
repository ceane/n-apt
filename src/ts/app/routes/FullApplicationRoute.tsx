import React from "react";
import { AuthenticatedAppShell } from "@n-apt/app/AuthenticatedAppShell";
import { RouteErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";

export default function FullApplicationRoute() {
  // Keep the authenticated route module itself lightweight. The auth boundary
  // must be able to render the login UI on a direct /visualizer (or /) request
  // without evaluating the Spectrum/WebSocket application graph first.
  return <AuthenticatedAppShell />;
}

export const ErrorBoundary = RouteErrorBoundary;

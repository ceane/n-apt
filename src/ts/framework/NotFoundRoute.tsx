import React from "react";

export default function NotFoundRoute() {
  return (
    <main role="alert" style={{ padding: 24 }}>
      Page not found.
    </main>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

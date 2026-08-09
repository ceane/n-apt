import React from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "The route could not be loaded.";

  return (
    <main role="alert" style={{ padding: 24 }}>
      <h1>Unable to load this page</h1>
      <p>{message} Please refresh and try again.</p>
    </main>
  );
}

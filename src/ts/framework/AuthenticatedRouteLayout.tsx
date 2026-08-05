import React from "react";
import { Outlet } from "react-router";

export default function AuthenticatedRouteLayout() {
  return <Outlet />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

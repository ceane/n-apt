import React from "react";
import { Outlet } from "react-router";

export default function PublicRouteLayout() {
  return <Outlet />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";

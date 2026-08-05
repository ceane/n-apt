import React from "react";
import { Navigate, useLocation } from "react-router";

const REDIRECTS: Record<string, string> = {
  "/faq": "/learn-signals",
  "/faq/iq-captures": "/learn-signals/iq-captures",
  "/iq-captures": "/learn-signals/iq-captures",
  "/faq/fft-ifft": "/learn-signals/fft-ifft",
  "/fft-ifft": "/learn-signals/fft-ifft",
};

export default function LegacyRedirectRoute() {
  const { pathname } = useLocation();
  return <Navigate to={REDIRECTS[pathname] ?? "/learn-signals"} replace />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";

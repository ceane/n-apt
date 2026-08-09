import React, { lazy, Suspense } from "react";
import { useLocation } from "react-router";

export type AuthenticatedShellKind = "onboarding" | "application";

/**
 * Keep authenticated onboarding separate from the full SDR application shell.
 * `/get-started` is protected, but it must not initialize the live streaming
 * provider tree just to render the lightweight starting-point page.
 */
export const getAuthenticatedShellKind = (
  pathname: string,
): AuthenticatedShellKind =>
  pathname === "/get-started" ? "onboarding" : "application";

const LazyAppShell = lazy(() =>
  import("@n-apt/app/AppShell").then((module) => ({ default: module.AppShell })),
);

const LazyGetStartedRoute = lazy(() =>
  import("@n-apt/app/routes/pages/GetStartedRoute").then((module) => ({
    default: module.default,
  })),
);

const ShellLoadingFallback: React.FC = () => (
  <div
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      color: "var(--color-text-secondary, #888888)",
      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      fontSize: 12,
    }}
  >
    Loading…
  </div>
);

export const AuthenticatedAppShell: React.FC = () => {
  const { pathname } = useLocation();
  const shellKind = getAuthenticatedShellKind(pathname);

  return (
    <Suspense fallback={<ShellLoadingFallback />}>
      {shellKind === "onboarding" ? <LazyGetStartedRoute /> : <LazyAppShell />}
    </Suspense>
  );
};

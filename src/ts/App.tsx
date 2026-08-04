import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { AuthenticationRoute as AuthRoute } from "@n-apt/routes/AuthenticationRoute";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import { PostAuthLandingRedirect } from "@n-apt/components/PostAuthLandingRedirect";
import { useRustRebuildStatus } from "@n-apt/hooks/useRustRebuildStatus";

// The full routed app (all providers + sidebars + the websocket streaming
// pipeline) is heavy. Lazy-load it inside the auth gate so the auth screen
// paints without downloading/parsing ReactFlow, the 3D/Model3D stack, or the
// spectrum streaming middleware graph.
const LazyAppShell = lazy(() =>
  import("@n-apt/AppShell").then((m) => ({ default: m.AppShell })),
);

const AppLoadingFallback = () => (
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

// Main App component with BrowserRouter wrapper
export const App: React.FC = () => {
  useRustRebuildStatus();
  return (
    <>
      <Helmet>
        <title>N-APT</title>
        <meta name="title" content="N-APT" />
        <meta
          name="description"
          content="Visualize FFTs/waterfalls, capture a snapshot or I/Q capture & more, tailored toward N-APT signals. Analyze, learn, record, document & demodulate N-APT signals."
        />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="N-APT" />
        <meta
          property="og:description"
          content="Visualize FFTs/waterfalls, capture a snapshot or I/Q capture & more, tailored toward N-APT signals. Analyze, learn, record, document & demodulate N-APT signals."
        />
        <meta property="og:site_name" content="N-APT" />

        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:title" content="N-APT" />
        <meta
          property="twitter:description"
          content="Visualize FFTs/waterfalls, capture a snapshot or I/Q capture & more, tailored toward N-APT signals. Analyze, learn, record, document & demodulate N-APT signals."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Helmet>
      <Router>
        <ReduxThemeProvider>
          <AuthProvider>
            {/* Wraps the auth-gated content so it observes the full auth
                lifecycle and can block the app from painting while a
                post-login redirect is pending. */}
            <PostAuthLandingRedirect>
              <AuthRoute>
                {/* The heavy app (websocket streaming pipeline + all routed
                    providers/sidebars) only mounts after authentication
                    succeeds, so the auth screen paints first. */}
                <Suspense fallback={<AppLoadingFallback />}>
                  <LazyAppShell />
                </Suspense>
              </AuthRoute>
            </PostAuthLandingRedirect>
          </AuthProvider>
        </ReduxThemeProvider>
      </Router>
    </>
  );
};

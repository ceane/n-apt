import React from "react";
import { Helmet } from "react-helmet-async";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { AuthenticationRoute as AuthRoute } from "@n-apt/routes/AuthenticationRoute";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import { PostAuthLandingRedirect } from "@n-apt/components/PostAuthLandingRedirect";
import { useRustRebuildStatus } from "@n-apt/hooks/useRustRebuildStatus";
import { AuthenticatedAppShell } from "@n-apt/AuthenticatedAppShell";

// Main App component. The Framework Mode root owns routing in production;
// Main.tsx supplies a BrowserRouter for the legacy Vite entry and stories.
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
      <ReduxThemeProvider>
        <AuthProvider>
          {/* Wraps the auth-gated content so it observes the full auth
              lifecycle and can block the app from painting while a
              post-login redirect is pending. */}
          <PostAuthLandingRedirect>
            <AuthRoute>
              <AuthenticatedAppShell />
            </AuthRoute>
          </PostAuthLandingRedirect>
        </AuthProvider>
      </ReduxThemeProvider>
    </>
  );
};

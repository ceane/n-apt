import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { Helmet } from "react-helmet-async";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthenticationRoute as AuthRoute } from "@n-apt/routes/AuthenticationRoute";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import ReduxProvider from "@n-apt/components/ReduxProvider";
import { PromptProvider, ReduxNotifications } from "@n-apt/components/ui";
import "katex/dist/katex.min.css";

declare global {
  interface Window {
    __naptRoot?: ReturnType<typeof createRoot>;
  }
}

// Main App component with BrowserRouter wrapper
export const App: React.FC = () => {
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
            <SpectrumProvider>
              <AuthRoute>
                <PromptProvider>
                  <AppRoutes />
                  <ReduxNotifications />
                </PromptProvider>
              </AuthRoute>
            </SpectrumProvider>
          </AuthProvider>
        </ReduxThemeProvider>
      </Router>
      {/* {(process.env.NODE_ENV === "development" || true) && (
        <>
          <Agentation
            className="agentation-toolbar"
            endpoint="http://localhost:4747"
            onSessionCreated={(sessionId) => {
              console.log("Session started:", sessionId);
            }}
          />
        </>
      )} */}
    </>
  );
};

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root element");
}

const root = window.__naptRoot ?? createRoot(container);
window.__naptRoot = root;

root.render(
  <HelmetProvider>
    <ReduxProvider>
      <App />
    </ReduxProvider>
  </HelmetProvider>,
);

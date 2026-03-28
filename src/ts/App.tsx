import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { Helmet } from "react-helmet-async";
import { Agentation } from "agentation";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthRoute } from "@n-apt/routes/AuthRoute";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import ReduxProvider from "@n-apt/components/ReduxProvider";
import { PromptProvider } from "@n-apt/components/ui";
import "katex/dist/katex.min.css";

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <>
      <Helmet>
        <title>n-apt - Signal Analysis Tool</title>
        <meta name="description" content="Advanced signal analysis and processing tool" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Helmet>
      <Router>
        <ReduxThemeProvider>
          <AuthProvider>
            <SpectrumProvider>
              <AuthRoute>
                <PromptProvider>
                  <AppRoutes />
                </PromptProvider>
              </AuthRoute>
            </SpectrumProvider>
          </AuthProvider>
        </ReduxThemeProvider>
      </Router>
      {(process.env.NODE_ENV === "development" || true) && (
        <>
          <Agentation
            className="agentation-toolbar"
            endpoint="http://localhost:4747"
            onSessionCreated={(sessionId) => {
              console.log("Session started:", sessionId);
            }}
          />
        </>
      )}
    </>
  );
};

// Render the app
const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <HelmetProvider>
      <ReduxProvider>
        <App />
      </ReduxProvider>
    </HelmetProvider>
  </React.StrictMode>,
);

import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { Agentation } from "agentation";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthRoute } from "@n-apt/routes/AuthRoute";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import { PromptProvider } from "@n-apt/components/ui";

// Main App component with BrowserRouter wrapper
const App: React.FC = () => (
  <>
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

export default App;

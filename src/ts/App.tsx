import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthRoute } from "@n-apt/routes/AuthRoute";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import { PromptProvider } from "@n-apt/components/ui";
import PWAInstallPrompt from "@n-apt/components/PWAInstallPrompt";

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <Router>
      <ReduxThemeProvider>
        <AuthProvider>
          <AuthRoute>
            <SpectrumProvider>
              <PromptProvider>
                <AppRoutes />
                <PWAInstallPrompt />
              </PromptProvider>
            </SpectrumProvider>
          </AuthRoute>
        </AuthProvider>
      </ReduxThemeProvider>
    </Router>
  );
};

export default App;

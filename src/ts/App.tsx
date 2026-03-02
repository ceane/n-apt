import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthWrapper } from "@n-apt/components/AuthWrapper";

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <AuthWrapper>
          <SpectrumProvider>
            <AppRoutes />
          </SpectrumProvider>
        </AuthWrapper>
      </AuthProvider>
    </Router>
  );
};

export default App;

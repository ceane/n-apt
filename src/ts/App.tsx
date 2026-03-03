import React from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthRoute } from "@n-apt/routes/AuthRoute";

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <AuthRoute>
          <SpectrumProvider>
            <AppRoutes />
          </SpectrumProvider>
        </AuthRoute>
      </AuthProvider>
    </Router>
  );
};

export default App;

import React, { useMemo } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { AppRoutes } from "@n-apt/routes/Routes";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthRoute } from "@n-apt/routes/AuthRoute";
import { ThemeProvider } from "styled-components";
import { useThemeStore } from "@n-apt/hooks/useThemeStore";
import { COLORS } from "@n-apt/consts";
import { PromptProvider } from "@n-apt/components/ui";
import PWAInstallPrompt from "@n-apt/components/PWAInstallPrompt";

// Main App component with BrowserRouter wrapper
const App: React.FC = () => {
  const accentColor = useThemeStore((state) => state.accentColor);
  const fftColor = useThemeStore((state) => state.fftColor);
  const appMode = useThemeStore((state) => state.appMode);

  const theme = useMemo(() => {
    const primaryAlpha = accentColor.startsWith("#") ? `${accentColor}33` : accentColor;
    const primaryAnchor = accentColor.startsWith("#") ? `${accentColor}1a` : accentColor;
    return {
      ...COLORS,
      primary: accentColor,
      primaryAlpha,
      primaryAnchor,
      fft: fftColor,
      mode: appMode,
    };
  }, [accentColor, fftColor, appMode]);

  return (
    <Router>
      <ThemeProvider theme={theme}>
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
      </ThemeProvider>
    </Router>
  );
};

export default App;

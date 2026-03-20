import React from "react";
import { ThemeProvider } from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import { buildAppTheme, GlobalThemeStyle, useResolvedThemeMode } from "@n-apt/components/ui/Theme";

interface ReduxThemeProviderProps {
  children: React.ReactNode;
}

const ReduxThemeProvider: React.FC<ReduxThemeProviderProps> = ({ children }) => {
  const themeState = useAppSelector((state) => state.theme);
  const resolvedMode = useResolvedThemeMode(themeState.appMode);

  const styledTheme = React.useMemo(
    () =>
      buildAppTheme({
        accentColor: themeState.accentColor,
        fftColor: themeState.fftColor,
        appMode: themeState.appMode,
        resolvedMode,
        waterfallTheme: themeState.waterfallTheme,
      }),
    [themeState.accentColor, themeState.appMode, themeState.fftColor, themeState.waterfallTheme, resolvedMode]
  );

  return (
    <ThemeProvider theme={styledTheme}>
      <GlobalThemeStyle />
      {children}
    </ThemeProvider>
  );
};

export default ReduxThemeProvider;

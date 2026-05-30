import React from "react";
import { ThemeProvider } from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import {
  buildAppTheme,
  GlobalThemeStyle,
  useResolvedThemeMode,
} from "@n-apt/components/ui/Theme";

interface ReduxThemeProviderProps {
  children: React.ReactNode;
}

const ReduxThemeProvider: React.FC<ReduxThemeProviderProps> = ({
  children,
}) => {
  const appMode = useAppSelector((state) => state.theme.appMode);
  const accentColor = useAppSelector((state) => state.theme.accentColor);
  const fftColor = useAppSelector((state) => state.theme.fftColor);
  const waterfallTheme = useAppSelector(
    (state) => state.theme.waterfallTheme,
  );
  const resolvedMode = useResolvedThemeMode(appMode);

  const styledTheme = React.useMemo(
    () =>
      buildAppTheme({
        accentColor,
        fftColor,
        appMode,
        resolvedMode,
        waterfallTheme,
      }),
    [accentColor, appMode, fftColor, waterfallTheme, resolvedMode],
  );

  return (
    <ThemeProvider theme={styledTheme}>
      <GlobalThemeStyle theme={styledTheme} />
      {children}
    </ThemeProvider>
  );
};

export default ReduxThemeProvider;

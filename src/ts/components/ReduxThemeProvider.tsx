import React from 'react';
import { ThemeProvider } from 'styled-components';
import { useAppSelector } from '@n-apt/redux';
import { selectThemeObject } from '@n-apt/redux';
import { COLORS } from '@n-apt/consts';

interface ReduxThemeProviderProps {
  children: React.ReactNode;
}

const ReduxThemeProvider: React.FC<ReduxThemeProviderProps> = ({ children }) => {
  const theme = useAppSelector(selectThemeObject);

  const styledTheme = React.useMemo(() => ({
    ...COLORS,
    ...theme,
  }), [theme]);

  return <ThemeProvider theme={styledTheme}>{children}</ThemeProvider>;
};

export default ReduxThemeProvider;

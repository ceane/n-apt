import React from "react";
import { createGlobalStyle } from "styled-components";
import {
  THEME_TOKENS,
  type ThemeMode,
  type ThemeColorToken,
} from "../../../rs/consts/theme";

type AppMode = "system" | ThemeMode;

interface BuildAppThemeOptions {
  accentColor: string;
  fftColor: string;
  appMode: AppMode;
  resolvedMode: ThemeMode;
  waterfallTheme: string;
}

type ThemeColorMap = Record<ThemeColorToken, string>;

export const APP_THEME_COLORS = THEME_TOKENS.colors;

const toAlphaHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");

const appendHexAlpha = (color: string, opacity: number) => {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${toAlphaHex(opacity)}`;
  }

  if (/^#[0-9a-fA-F]{8}$/.test(color)) {
    return `${color.slice(0, 7)}${toAlphaHex(opacity)}`;
  }

  return color;
};

const toCssVarName = (prefix: string, key: string) =>
  `--${prefix}-${key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase()}`;

const getSystemMode = (): ThemeMode => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const useResolvedThemeMode = (appMode: AppMode): ThemeMode => {
  const [systemMode, setSystemMode] = React.useState<ThemeMode>(() => getSystemMode());

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemMode(event.matches ? "dark" : "light");
    };

    setSystemMode(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return appMode === "system" ? systemMode : appMode;
};

export interface AppStyledTheme {
  mode: ThemeMode;
  requestedMode: AppMode;
  waterfallTheme: string;
  colors: ThemeColorMap;
  typography: typeof THEME_TOKENS.typography;
  spacing: typeof THEME_TOKENS.spacing;
  layout: typeof THEME_TOKENS.layout;
  primary: string;
  primaryAlpha: string;
  primaryAnchor: string;
  fft: string;
  cssVariables: Record<string, string | number>;
  [key: string]:
  | string
  | number
  | ThemeColorMap
  | typeof THEME_TOKENS.typography
  | typeof THEME_TOKENS.spacing
  | typeof THEME_TOKENS.layout
  | Record<string, string | number>;
}

export const buildAppTheme = ({
  accentColor,
  fftColor,
  appMode,
  resolvedMode,
  waterfallTheme,
}: BuildAppThemeOptions): AppStyledTheme => {
  const baseColors = APP_THEME_COLORS[resolvedMode];
  const colors: ThemeColorMap = {
    ...baseColors,
    primary: accentColor,
    fftLine: fftColor,
    fftShadow: appendHexAlpha(fftColor, resolvedMode === "dark" ? 0.2 : 0.18),
    activeBackground: appendHexAlpha(accentColor, 0.15),
  };

  const cssVariables: Record<string, string | number> = {
    "--theme-mode": resolvedMode,
  };

  Object.entries(colors).forEach(([key, value]) => {
    cssVariables[toCssVarName("color", key)] = value;
  });

  Object.entries(THEME_TOKENS.typography).forEach(([key, value]) => {
    cssVariables[toCssVarName("font", key)] = value;
  });

  Object.entries(THEME_TOKENS.spacing).forEach(([key, value]) => {
    cssVariables[toCssVarName("space", key)] = value;
  });

  Object.entries(THEME_TOKENS.layout).forEach(([key, value]) => {
    cssVariables[toCssVarName("layout", key)] = value;
  });

  return {
    mode: resolvedMode,
    requestedMode: appMode,
    waterfallTheme,
    colors,
    typography: THEME_TOKENS.typography,
    spacing: THEME_TOKENS.spacing,
    layout: THEME_TOKENS.layout,
    primary: colors.primary,
    primaryAlpha: appendHexAlpha(colors.primary, 0.2),
    primaryAnchor: appendHexAlpha(colors.primary, 0.1),
    fft: colors.fftLine,
    cssVariables,
    ...colors,
    ...THEME_TOKENS.typography,
    ...THEME_TOKENS.spacing,
    ...THEME_TOKENS.layout,
  };
};

export const GlobalThemeStyle = createGlobalStyle`
  :root {
    ${({ theme }) =>
    Object.entries(theme.cssVariables)
      .map(([name, value]) => `${name}: ${value};`)
      .join("\n")}
  }

  html,
  body,
  #root {
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.textPrimary};
    font-family: ${({ theme }) => theme.typography.body};
    overscroll-behavior-x: none;
  }

  body {
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  /* KaTeX theming */
  .katex {
    color: ${({ theme }) => theme.colors.textPrimary} !important;
  }
  
  .katex .katex-mathml {
    color: ${({ theme }) => theme.colors.textPrimary} !important;
  }
  
  .katex .katex-html {
    color: ${({ theme }) => theme.colors.textPrimary} !important;
  }
  
  .katex .base {
    color: ${({ theme }) => theme.colors.textPrimary} !important;
  }
  
  .katex .strut {
    color: ${({ theme }) => theme.colors.textPrimary} !important;
  }
  
  .katex .mopen, .katex .mclose, .katex .mrel, .katex .mbin, .katex .mpunct, .katex .mord, .katex .msupsub, .katex .mfrac, .katex .mrule, .katex .mtable, .katex .mtr, .katex .mtd {
    color: ${({ theme }) => theme.colors.textPrimary} !important;
  }
`;

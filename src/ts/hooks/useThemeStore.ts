import { create } from "zustand";
import { persist } from "zustand/middleware";
import { COLORS } from "@n-apt/consts";

export type AppMode = "system" | "dark" | "light";

export interface ThemeState {
  appMode: AppMode;
  accentColor: string;
  fftColor: string;
  waterfallTheme: string; // ID from WATERFALL_COLORMAPS
  
  setAppMode: (mode: AppMode) => void;
  setAccentColor: (color: string) => void;
  setFftColor: (color: string) => void;
  setWaterfallTheme: (theme: string) => void;
  resetTheme: () => void;
}

const DEFAULTS = {
  appMode: "system" as AppMode,
  accentColor: COLORS.primary,
  fftColor: "#00d4ff",
  waterfallTheme: "classic",
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      
      setAppMode: (appMode) => set({ appMode }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setFftColor: (fftColor) => set({ fftColor }),
      setWaterfallTheme: (waterfallTheme) => set({ waterfallTheme }),
      resetTheme: () => set({ ...DEFAULTS }),
    }),
    {
      name: "napt-theme-storage",
    }
  )
);

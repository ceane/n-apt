import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { THEME_TOKENS } from '../../../rs/consts/theme';

export type AppMode = "system" | "dark" | "light";

export interface ThemeState {
  appMode: AppMode;
  accentColor: string;
  fftColor: string;
  waterfallTheme: string; // ID from WATERFALL_COLORMAPS
}

const DEFAULTS = {
  appMode: "system" as AppMode,
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  waterfallTheme: "classic",
};

const initialState: ThemeState = DEFAULTS;

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setAppMode: (state, action: PayloadAction<AppMode>) => {
      state.appMode = action.payload;
    },
    
    setAccentColor: (state, action: PayloadAction<string>) => {
      state.accentColor = action.payload;
    },
    
    setFftColor: (state, action: PayloadAction<string>) => {
      state.fftColor = action.payload;
    },
    
    setWaterfallTheme: (state, action: PayloadAction<string>) => {
      state.waterfallTheme = action.payload;
    },
    
    resetTheme: (state) => {
      Object.assign(state, DEFAULTS);
    },
    
    // Bulk update for efficiency
    updateThemeSettings: (state, action: PayloadAction<Partial<ThemeState>>) => {
      Object.assign(state, action.payload);
    },
  },
});

export const {
  setAppMode,
  setAccentColor,
  setFftColor,
  setWaterfallTheme,
  resetTheme,
  updateThemeSettings,
} = themeSlice.actions;

export default themeSlice.reducer;

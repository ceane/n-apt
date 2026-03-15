import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import authSlice from '../../src/ts/redux/slices/authSlice';
import spectrumSlice from '../../src/ts/redux/slices/spectrumSlice';
import waterfallSlice from '../../src/ts/redux/slices/waterfallSlice';
import themeSlice from '../../src/ts/redux/slices/themeSlice';
import settingsSlice from '../../src/ts/redux/slices/settingsSlice';
import websocketSlice from '../../src/ts/redux/slices/websocketSlice';

const defaultTheme = {
  background: '#000000',
  surface: '#141414',
  border: '#1a1a1a',
  textPrimary: '#cccccc',
  textSecondary: '#888888',
  primary: '#4a9eff',
  success: '#4ade80',
  danger: '#ff4444',
  warning: '#fbbf24',
  metadataLabel: '#555555',
  metadataValue: '#cccccc',
  fileMode: '#d9aa34',
};

export function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice,
      spectrum: spectrumSlice,
      waterfall: waterfallSlice,
      theme: themeSlice,
      settings: settingsSlice,
      websocket: websocketSlice,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
  });
}

export function TestWrapper({ children }: { children: React.ReactNode }) {
  const store = createTestStore();

  return (
    <Provider store={store}>
      <ThemeProvider theme={defaultTheme}>
        {children}
      </ThemeProvider>
    </Provider>
  );
}

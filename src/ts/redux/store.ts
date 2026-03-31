import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

// Import slices (will be created next)
import authSlice from "@n-apt/redux/slices/authSlice";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import waterfallSlice from "@n-apt/redux/slices/waterfallSlice";
import themeSlice from "@n-apt/redux/slices/themeSlice";
import settingsSlice from "@n-apt/redux/slices/settingsSlice";
import websocketSlice from "@n-apt/redux/slices/websocketSlice";
import noteCardsSlice from "@n-apt/redux/slices/noteCardsSlice";
import notificationsSlice from "@n-apt/redux/slices/notificationsSlice";

// Import middleware (will be created next)
import websocketMiddleware from "@n-apt/redux/middleware/websocketMiddleware";
import localStorageMiddleware from "@n-apt/redux/middleware/localStorageMiddleware";

export const store = configureStore({
  reducer: {
    auth: authSlice,
    spectrum: spectrumSlice,
    waterfall: waterfallSlice,
    theme: themeSlice,
    settings: settingsSlice,
    websocket: websocketSlice,
    noteCards: noteCardsSlice,
    notifications: notificationsSlice,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for serialization checks
        ignoredActions: [
          'websocket/connect',
          'websocket/disconnect',
          'websocket/connect/pending',
          'websocket/connect/fulfilled',
          'websocket/connect/rejected',
          'websocket/disconnect/pending',
          'websocket/disconnect/fulfilled',
          'websocket/disconnect/rejected',
          'persist/PERSIST',
          'persist/REHYDRATE',
        ],
        ignoredPaths: ['persistedState'],
        ignoredActionPaths: ['payload.aesKey', 'meta.arg.aesKey'],
      },
    }).concat(
      websocketMiddleware,
      localStorageMiddleware
    ),
  devTools: process.env.NODE_ENV !== 'production',
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export default store;

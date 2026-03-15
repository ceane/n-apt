import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

// Import slices (will be created next)
import authSlice from './slices/authSlice';
import spectrumSlice from './slices/spectrumSlice';
import waterfallSlice from './slices/waterfallSlice';
import themeSlice from './slices/themeSlice';
import settingsSlice from './slices/settingsSlice';
import websocketSlice from './slices/websocketSlice';

// Import middleware (will be created next)
import websocketMiddleware from './middleware/websocketMiddleware';
import indexedDBMiddleware from './middleware/indexedDBMiddleware';
import localStorageMiddleware from './middleware/localStorageMiddleware';

export const store = configureStore({
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
      indexedDBMiddleware,
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

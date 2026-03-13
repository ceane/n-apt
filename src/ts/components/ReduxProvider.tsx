import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from '@n-apt/redux';
import { 
  loadPersistedTheme, 
  loadPersistedSdrSettings, 
  loadPersistedPasskeys,
  loadPersistedSpectrumFrames,
  loadPersistedSdrSettingsCache,
  loadPersistedWaterfallData,
  loadPersistedWebSocketData,
} from '@n-apt/redux';
import { themeActions, authActions, spectrumActions, websocketActions } from '@n-apt/redux';

interface ReduxProviderProps {
  children: React.ReactNode;
}

const ReduxProvider: React.FC<ReduxProviderProps> = ({ children }) => {
  useEffect(() => {
    // Load persisted data on app startup
    const initializePersistedData = async () => {
      try {
        // Load theme data
        const themeData = loadPersistedTheme();
        if (themeData) {
          store.dispatch(themeActions.updateThemeSettings(themeData));
        }

        // Load SDR settings
        const sdrSettings = loadPersistedSdrSettings();
        if (Object.keys(sdrSettings).length > 0) {
          store.dispatch(spectrumActions.setSdrSettingsBundle(sdrSettings));
        }

        // Load passkey settings
        const hasPasskeys = loadPersistedPasskeys();
        store.dispatch(authActions.setHasPasskeys(hasPasskeys));

        // Load cached spectrum frames
        const spectrumFrames = loadPersistedSpectrumFrames();
        if (spectrumFrames.length > 0) {
          store.dispatch(websocketActions.setSpectrumFrames(spectrumFrames));
        }

        // Load cached SDR settings from WebSocket
        const sdrSettingsCache = loadPersistedSdrSettingsCache();
        if (sdrSettingsCache) {
          store.dispatch(websocketActions.updateDeviceState({ sdrSettings: sdrSettingsCache }));
        }

        // Load large datasets from IndexedDB
        const waterfallData = await loadPersistedWaterfallData();
        if (waterfallData['waterfall:drawParams']) {
          store.dispatch({ type: 'waterfall/setDrawParams', payload: waterfallData['waterfall:drawParams'] });
        }

        const websocketData = await loadPersistedWebSocketData();
        if (websocketData['websocket:spectrumFrames']) {
          store.dispatch(websocketActions.setSpectrumFrames(websocketData['websocket:spectrumFrames']));
        }
        if (websocketData['websocket:captureStatus']) {
          store.dispatch(websocketActions.setCaptureStatus(websocketData['websocket:captureStatus']));
        }

        console.log('Redux provider initialized with persisted data');
      } catch (error) {
        console.error('Failed to load persisted data:', error);
      }
    };

    initializePersistedData();
  }, []);

  return <Provider store={store}>{children}</Provider>;
};

export default ReduxProvider;

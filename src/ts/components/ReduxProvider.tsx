import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from '@n-apt/redux';
import {
  loadPersistedTheme,
  loadPersistedSdrSettings,
  loadPersistedPasskeys,
  loadPersistedSpectrumFrames,
  loadPersistedSdrSettingsCache,
} from '@n-apt/redux';
import { themeActions, authActions, spectrumActions, websocketActions } from '@n-apt/redux';

interface ReduxProviderProps {
  children: React.ReactNode;
}

const ReduxProvider: React.FC<ReduxProviderProps> = ({ children }) => {
  useEffect(() => {
    try {
      const themeData = loadPersistedTheme();
      if (themeData) {
        store.dispatch(themeActions.updateThemeSettings(themeData));
      }

      const sdrSettings = loadPersistedSdrSettings();
      if (Object.keys(sdrSettings).length > 0) {
        store.dispatch(spectrumActions.setSdrSettingsBundle(sdrSettings));
      }

      store.dispatch(authActions.setHasPasskeys(loadPersistedPasskeys()));

      const spectrumFrames = loadPersistedSpectrumFrames();
      if (spectrumFrames.length > 0) {
        store.dispatch(websocketActions.setSpectrumFrames(spectrumFrames));
      }

      const sdrSettingsCache = loadPersistedSdrSettingsCache();
      if (sdrSettingsCache) {
        store.dispatch(
          websocketActions.updateDeviceState({ sdrSettings: sdrSettingsCache }),
        );
      }

      if (!window.__reduxProviderInitialized) {
        console.log('Redux provider initialized with persisted data');
        window.__reduxProviderInitialized = true;
      }
    } catch (error) {
      console.error('Failed to load persisted data:', error);
    }
  }, []);

  return <Provider store={store}>{children}</Provider>;
};

export default ReduxProvider;

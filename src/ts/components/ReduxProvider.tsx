import React, { useEffect } from "react";
import { Provider } from "react-redux";
import { store } from "@n-apt/redux";
import {
  loadPersistedTheme,
  loadPersistedSdrSettings,
  loadPersistedPasskeys,
  loadPersistedSpectrumFrames,
  loadPersistedSdrSettingsCache,
  loadPersistedNoteCards,
} from "@n-apt/redux";
import {
  themeActions,
  authActions,
  spectrumActions,
  websocketActions,
  hydrateNoteCards,
  setNoteCardsCollapsed,
} from "@n-apt/redux";

declare global {
  interface Window {
    __reduxProviderInitialized?: boolean;
  }
}

interface ReduxProviderProps {
  children: React.ReactNode;
}

const ReduxProvider: React.FC<ReduxProviderProps> = ({ children }) => {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
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
            websocketActions.updateDeviceState({
              sdrSettings: sdrSettingsCache,
            }),
          );
        }

        const persistedNoteCards = await loadPersistedNoteCards();
        if (!cancelled) {
          if (persistedNoteCards.cards.length > 0) {
            store.dispatch(hydrateNoteCards(persistedNoteCards.cards));
          }
          store.dispatch(setNoteCardsCollapsed(persistedNoteCards.isCollapsed));
        }

        if (!window.__reduxProviderInitialized) {
          console.log("Redux provider initialized with persisted data");
          window.__reduxProviderInitialized = true;
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load persisted data:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <Provider store={store}>{children}</Provider>;
};

export default ReduxProvider;

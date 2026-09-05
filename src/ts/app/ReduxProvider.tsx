import React, { useEffect } from "react";
import { Provider } from "react-redux";
import { store } from "@n-apt/redux";
import {
  loadPersistedTheme,
  loadPersistedSdrSettings,
  loadPersistedPasskeys,
  loadPersistedSpectrumFrames,
  loadPersistedSignalsDefaults,
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

        const signalsDefaults = loadPersistedSignalsDefaults();
        if (signalsDefaults) {
          store.dispatch(
            websocketActions.updateDeviceState({
              signalsDefaults,
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

      } catch {
        // Best-effort hydration: a failed read leaves defaults in place.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <Provider store={store}>{children}</Provider>;
};

export default ReduxProvider;

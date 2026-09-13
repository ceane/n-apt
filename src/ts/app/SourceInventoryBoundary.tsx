import React, { useEffect } from "react";
import { buildWsUrl } from "@n-apt/app/infrastructure/services/auth";
import {
  connectWebSocket,
  disconnectWebSocket,
} from "@n-apt/redux/thunks/websocketThunks";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useAppDispatch } from "@n-apt/redux/store";

/**
 * Owns the authenticated control-plane connection shared by onboarding and
 * the full SDR application. Source inventory is Redux state, so consumers do
 * not need to mount the spectrum store just to discover connected hardware.
 */
export const SourceInventoryBoundary: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const dispatch = useAppDispatch();
  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const wsUrl = sessionToken ? buildWsUrl(sessionToken) : "";

  useEffect(() => {
    if (!isAuthenticated || !wsUrl) {
      dispatch(disconnectWebSocket());
      return;
    }

    dispatch(
      connectWebSocket({
        url: wsUrl,
        aesKey,
        enabled: true,
      }),
    );

    return () => {
      dispatch(disconnectWebSocket());
    };
  }, [aesKey, dispatch, isAuthenticated, wsUrl]);

  return <>{children}</>;
};

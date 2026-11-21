import React from "react";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useAppSelector } from "@n-apt/redux";

export const AuthenticatedOnly: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { isAuthenticated } = useAuthentication();
  const isBackendConnected = useAppSelector(
    (state) => state.websocket.isConnected,
  );

  if (!isAuthenticated || !isBackendConnected) return null;
  return <>{children}</>;
};

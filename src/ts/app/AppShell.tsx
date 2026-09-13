import React from "react";
import { SpectrumProvider } from "@n-apt/spectrum/public/useSpectrumStore";
import { AppRoutes } from "@n-apt/app/routes/pages/Routes";
import { PromptProvider } from "@n-apt/ui/PromptProvider";
import { ReduxNotifications } from "@n-apt/ui/ReduxNotifications";

/**
 * The authenticated application shell. Everything here is heavy — the websocket
 * streaming pipeline (SpectrumProvider), the routed providers/sidebars
 * (AppRoutes), and the shared prompt/notification surface. App.tsx lazy-loads
 * this module, so none of it runs until authentication succeeds and the auth
 * screen has already painted.
 */
export const AppShell: React.FC = () => {
  return (
    <SpectrumProvider>
      <PromptProvider>
        <AppRoutes />
        <ReduxNotifications />
      </PromptProvider>
    </SpectrumProvider>
  );
};

export default AppShell;

import React from "react";
import { MapLocationsProvider } from "@n-apt/hooks/useMapLocations";
import { MapRoutePathsProvider } from "@n-apt/hooks/useMapRoutePaths";

export const MapRouteProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MapLocationsProvider>
    <MapRoutePathsProvider>{children}</MapRoutePathsProvider>
  </MapLocationsProvider>
);

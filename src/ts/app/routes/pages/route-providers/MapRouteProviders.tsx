import React from "react";
import { MapLocationsProvider } from "@n-apt/maps/hooks/useMapLocations";
import { MapRoutePathsProvider } from "@n-apt/maps/hooks/useMapRoutePaths";

export const MapRouteProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MapLocationsProvider>
    <MapRoutePathsProvider>{children}</MapRoutePathsProvider>
  </MapLocationsProvider>
);

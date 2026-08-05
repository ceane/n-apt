import React from "react";
import { DrawSignalPaginationProvider } from "@n-apt/contexts/DrawSignalPaginationContext";

export const DrawSignalRouteProviders: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <DrawSignalPaginationProvider>{children}</DrawSignalPaginationProvider>
);

import React from "react";
import { DrawSignalPaginationProvider } from "@n-apt/draw-signal/public/context/DrawSignalPaginationContext";

export const DrawSignalRouteProviders: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <DrawSignalPaginationProvider>{children}</DrawSignalPaginationProvider>
);

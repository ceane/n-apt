import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { DemodProvider } from "@n-apt/demodulation/public";
import { DemodulateSidebar } from "@n-apt/demodulation/sidebar/DemodulateSidebar";

export const DemodSidebarAdapter: React.FC = () => <DemodulateSidebar />;

export const DemodRouteProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <DemodProvider>
    <ReactFlowProvider>{children}</ReactFlowProvider>
  </DemodProvider>
);

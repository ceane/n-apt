import React from "react";
import { Routes, Route } from "react-router-dom";
import { MainLayout } from "@n-apt/components/MainLayout";
import { SpectrumSidebar } from "@n-apt/components/sidebar/SpectrumSidebar";
import { AnalysisSidebar } from "@n-apt/components/sidebar/AnalysisSidebar";
import { DrawSignalSidebar } from "@n-apt/components/sidebar/DrawSignalSidebar";
import { SpectrumRoute } from "./SpectrumRoute";
import { DecodeRoute } from "./DecodeRoute";
import { DrawSignalRoute } from "./DrawSignalRoute";
import { Model3DRoute } from "./Model3DRoute";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { HotspotEditorProvider } from "@n-apt/hooks/useHotspotEditor";
import { SidebarForRoute } from "@n-apt/components/sidebar/SidebarForRoute";

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <MainLayout sidebar={<SpectrumSidebar />}>
            <SpectrumRoute activeTab="visualizer" />
          </MainLayout>
        }
      />
      <Route
        path="/visualizer"
        element={
          <MainLayout sidebar={<SpectrumSidebar />}>
            <SpectrumRoute activeTab="visualizer" />
          </MainLayout>
        }
      />
      <Route
        path="/analysis"
        element={
          <MainLayout sidebar={<AnalysisSidebar />}>
            <DecodeRoute />
          </MainLayout>
        }
      />
      <Route
        path="/draw-signal"
        element={
          <MainLayout sidebar={<DrawSignalSidebar />}>
            <DrawSignalRoute />
          </MainLayout>
        }
      />
      <Route
        path="/3d-model"
        element={
          <Model3DProvider>
            <HotspotEditorProvider>
              <MainLayout sidebar={<SidebarForRoute />}>
                <Model3DRoute />
              </MainLayout>
            </HotspotEditorProvider>
          </Model3DProvider>
        }
      />
    </Routes>
  );
};

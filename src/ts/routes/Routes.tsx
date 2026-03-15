import React from "react";
import { Routes, Route } from "react-router-dom";
import { MainLayout } from "@n-apt/components/MainLayout";
import { SpectrumSidebar } from "@n-apt/components/sidebar/SpectrumSidebar";
import { AnalysisSidebar } from "@n-apt/components/sidebar/AnalysisSidebar";
import { DrawSignalSidebar } from "@n-apt/components/sidebar/DrawSignalSidebar";
import { MapEndpointsSidebar } from "@n-apt/components/sidebar/MapEndpointsSidebar";
import { SpectrumRoute } from "./SpectrumRoute";
import { DemodRoute } from "./DemodRoute";
import { DrawSignalRoute } from "./DrawSignalRoute";
import { Model3DRoute } from "./Model3DRoute";
import { MapEndpointsRoute } from "./MapEndpointsRoute";
import { StitchTestRoute } from "./StitchTestRoute";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { HotspotEditorProvider } from "@n-apt/hooks/useHotspotEditor";
import { SidebarForRoute } from "@n-apt/components/sidebar/SidebarForRoute";
import { SDRTestSidebar } from "@n-apt/components/sidebar/SDRTestSidebar";
import { MapLocationsProvider } from "@n-apt/hooks/useMapLocations";

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
        path="/demodulate"
        element={
          <MainLayout sidebar={<AnalysisSidebar />}>
            <DemodRoute />
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
      <Route
        path="/map-endpoints"
        element={
          <MapLocationsProvider>
            <MainLayout sidebar={<MapEndpointsSidebar />}>
              <MapEndpointsRoute />
            </MainLayout>
          </MapLocationsProvider>
        }
      />
      <Route
        path="/stitch-test"
        element={
          <MainLayout sidebar={<SDRTestSidebar />}>
            <StitchTestRoute />
          </MainLayout>
        }
      />
    </Routes>
  );
};

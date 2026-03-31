import React from "react";
import { Routes, Route } from "react-router-dom";
import { MainLayout } from "@n-apt/components/MainLayout";
import { SpectrumSidebar } from "@n-apt/components/sidebar/SpectrumSidebar";

import { DemodulateSidebar } from "@n-apt/components/sidebar/DemodulateSidebar";
import { DrawSignalSidebar } from "@n-apt/components/sidebar/DrawSignalSidebar";

import { MapEndpointsSidebar } from "@n-apt/components/sidebar/MapEndpointsSidebar";
import { SpectrumRoute } from "@n-apt/routes/SpectrumRoute";
import { DemodRoute } from "@n-apt/routes/DemodRoute";
import { DrawSignalRoute } from "@n-apt/routes/DrawSignalRoute";
import { Model3DRoute } from "@n-apt/routes/Model3DRoute";
import { MapEndpointsRoute } from "@n-apt/routes/MapEndpointsRoute";
import { StitchTestRoute } from "@n-apt/routes/StitchTestRoute";
import { PretextDemoRoute } from "@n-apt/routes/PretextDemoRoute";
import { VFOGridDemoRoute } from "@n-apt/routes/VFOGridDemoRoute";
import { TransformersRoute } from "@n-apt/routes/TransformersRoute";
import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { Model3DInteractionProvider as HotspotEditorProvider } from "@n-apt/hooks/useHotspotEditor";

import { DemodProvider, useDemod } from "@n-apt/contexts/DemodContext";

// Create a wrapper component to manage scanner state
const DemodRouteWithSidebarContent: React.FC = () => {
  const {
    windowSizeHz, setWindowSizeHz,
    stepSizeHz, setStepSizeHz,
    audioThreshold, setAudioThreshold,
    scanner, currentFreq, scanRange,
    startScan, stopScan
  } = useDemod();

  return (
    <MainLayout
      sidebar={
        <DemodulateSidebar
          windowSizeHz={windowSizeHz}
          stepSizeHz={stepSizeHz}
          audioThreshold={audioThreshold}
          onWindowSizeChange={setWindowSizeHz}
          onStepSizeChange={setStepSizeHz}
          onAudioThresholdChange={setAudioThreshold}
          isScanning={scanner.isScanning}
          scanProgress={scanner.scanProgress}
          scanCurrentFreq={currentFreq}
          scanRange={scanRange}
          detectedRegions={scanner.detectedRegions.length}
          onScanStart={startScan}
          onScanStop={stopScan}
        />
      }
    >
      <DemodRoute />
    </MainLayout>
  );
};

const DemodRouteWithSidebar: React.FC = () => (
  <DemodProvider>
    <DemodRouteWithSidebarContent />
  </DemodProvider>
);
import { Model3DSidebar } from "@n-apt/components/sidebar/Model3DSidebar";
import { SDRTestSidebar } from "@n-apt/components/sidebar/SDRTestSidebar";
import { MapLocationsProvider } from "@n-apt/hooks/useMapLocations";

const TestRouteSidebar: React.FC = () => <div data-testid="route-sidebar" />;

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
        element={<DemodRouteWithSidebar />}
      />
      <Route
        path="/draw-signal"
        element={
          <MainLayout
            sidebar={<DrawSignalSidebar />}
          >
            <DrawSignalRoute />
          </MainLayout>
        }
      />
      <Route
        path="/3d-model"
        element={
          <Model3DProvider>
            <HotspotEditorProvider>
              <MainLayout sidebar={process.env.NODE_ENV === "test" ? <TestRouteSidebar /> : <Model3DSidebar />}>
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
      <Route
        path="/pretext-demo"
        element={<PretextDemoRoute />}
      />
      <Route
        path="/vfo-grid-demo"
        element={<VFOGridDemoRoute />}
      />
      <Route
        path="/transformers"
        element={<TransformersRoute />}
      />
    </Routes>
  );
};

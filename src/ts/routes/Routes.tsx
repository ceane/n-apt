import React, { lazy, Suspense } from "react";
import styled from "styled-components";
import { Routes, Route } from "react-router-dom";
import { MainLayout } from "@n-apt/components/MainLayout";
import { SpectrumSidebar } from "@n-apt/components/sidebar/SpectrumSidebar";

import { DemodulateSidebar } from "@n-apt/components/sidebar/DemodulateSidebar";
import { DrawSignalSidebar } from "@n-apt/components/sidebar/DrawSignalSidebar";
import { MapEndpointsSidebar } from "@n-apt/components/sidebar/MapEndpointsSidebar";
import { Model3DSidebar } from "@n-apt/components/sidebar/Model3DSidebar";
import { SDRTestSidebar } from "@n-apt/components/sidebar/SDRTestSidebar";

// Lazy load route components
const SpectrumRoute = lazy(() => import("@n-apt/routes/SpectrumRoute").then(m => ({ default: m.SpectrumRoute })));
const DemodRoute = lazy(() => import("@n-apt/routes/DemodRoute").then(m => ({ default: m.DemodRoute })));
const DrawSignalRoute = lazy(() => import("@n-apt/routes/DrawSignalRoute").then(m => ({ default: m.DrawSignalRoute })));
const Model3DRoute = lazy(() => import("@n-apt/routes/Model3DRoute").then(m => ({ default: m.Model3DRoute })));
const MapEndpointsRoute = lazy(() => import("@n-apt/routes/MapEndpointsRoute").then(m => ({ default: m.MapEndpointsRoute })));
const StitchTestRoute = lazy(() => import("@n-apt/routes/StitchTestRoute").then(m => ({ default: m.StitchTestRoute })));
const PretextDemoRoute = lazy(() => import("@n-apt/routes/PretextDemoRoute").then(m => ({ default: m.PretextDemoRoute })));
const VFOGridDemoRoute = lazy(() => import("@n-apt/routes/VFOGridDemoRoute").then(m => ({ default: m.VFOGridDemoRoute })));
const TransformersRoute = lazy(() => import("@n-apt/routes/TransformersRoute").then(m => ({ default: m.TransformersRoute })));

import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { Model3DInteractionProvider as HotspotEditorProvider } from "@n-apt/hooks/useHotspotEditor";

import { DemodProvider, useDemod } from "@n-apt/contexts/DemodContext";
import { ReactFlowProvider } from "@xyflow/react";
import { MapLocationsProvider } from "@n-apt/hooks/useMapLocations";

// Create a wrapper component to manage scanner state
const DemodRouteWithSidebar: React.FC = () => {
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
      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
        <DemodRoute />
      </Suspense>
    </MainLayout>
  );
};
const TestRouteSidebar: React.FC = () => <div data-testid="route-sidebar" />;

const RouteLoadingFallback = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100vh;
  text-align: center;
`;

export const AppRoutes: React.FC = () => {
  return (
    <DemodProvider>
      <ReactFlowProvider>
        <Model3DProvider>
          <HotspotEditorProvider>
            <MapLocationsProvider>
              <Routes>
                <Route
                  path="/"
                  element={
                    <MainLayout sidebar={<SpectrumSidebar />}>
                      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                        <SpectrumRoute activeTab="visualizer" />
                      </Suspense>
                    </MainLayout>
                  }
                />
                <Route
                  path="/visualizer"
                  element={
                    <MainLayout sidebar={<SpectrumSidebar />}>
                      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                        <SpectrumRoute activeTab="visualizer" />
                      </Suspense>
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
                      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                        <DrawSignalRoute />
                      </Suspense>
                    </MainLayout>
                  }
                />
                <Route
                  path="/3d-model"
                  element={
                    <MainLayout sidebar={process.env.NODE_ENV === "test" ? <TestRouteSidebar /> : <Model3DSidebar />}>
                      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                        <Model3DRoute />
                      </Suspense>
                    </MainLayout>
                  }
                />
                <Route
                  path="/map-endpoints"
                  element={
                    <MainLayout sidebar={<MapEndpointsSidebar />}>
                      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                        <MapEndpointsRoute />
                      </Suspense>
                    </MainLayout>
                  }
                />
                <Route
                  path="/stitch-test"
                  element={
                    <MainLayout sidebar={<SDRTestSidebar />}>
                      <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                        <StitchTestRoute />
                      </Suspense>
                    </MainLayout>
                  }
                />
                <Route
                  path="/pretext-demo"
                  element={
                    <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                      <PretextDemoRoute />
                    </Suspense>
                  }
                />
                <Route
                  path="/vfo-grid-demo"
                  element={
                    <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                      <VFOGridDemoRoute />
                    </Suspense>
                  }
                />
                <Route
                  path="/transformers"
                  element={
                    <Suspense fallback={<RouteLoadingFallback>Loading...</RouteLoadingFallback>}>
                      <TransformersRoute />
                    </Suspense>
                  }
                />
              </Routes>
            </MapLocationsProvider>
          </HotspotEditorProvider>
        </Model3DProvider>
      </ReactFlowProvider>
    </DemodProvider>
  );
};

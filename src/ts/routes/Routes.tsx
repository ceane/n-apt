import React, { lazy, Suspense, useEffect, useState } from "react";
import { useCallback, useRef } from "react";
import styled from "styled-components";
import { Routes, Route } from "react-router-dom";
import { MainLayout } from "@n-apt/components/MainLayout";
import { SpectrumSidebar } from "@n-apt/components/sidebar/SpectrumSidebar";
import { DrawSignalPaginationProvider } from "@n-apt/contexts/DrawSignalPaginationContext";
import type { FFTCanvasHandle } from "@n-apt/components";

import { DemodulateSidebar } from "@n-apt/components/sidebar/DemodulateSidebar";
import { DrawSignalSidebar } from "@n-apt/components/sidebar/DrawSignalSidebar";
import { MapEndpointsSidebar } from "@n-apt/components/sidebar/MapEndpointsSidebar";
import { Model3DSidebar } from "@n-apt/components/sidebar/Model3DSidebar";
import { SDRTestSidebar } from "@n-apt/components/sidebar/SDRTestSidebar";

// Lazy load route components
const SpectrumRoute = lazy(() =>
  import("@n-apt/routes/SpectrumRoute").then((m) => ({
    default: m.SpectrumRoute,
  })),
);
const DemodRoute = lazy(() =>
  import("@n-apt/routes/DemodRoute").then((m) => ({ default: m.DemodRoute })),
);
const DrawSignalRoute = lazy(() =>
  import("@n-apt/routes/DrawSignalRoute").then((m) => ({
    default: m.DrawSignalRoute,
  })),
);
const Model3DRoute = lazy(() =>
  import("@n-apt/routes/Model3DRoute").then((m) => ({
    default: m.Model3DRoute,
  })),
);
const MapEndpointsRoute = lazy(() =>
  import("@n-apt/routes/MapEndpointsRoute").then((m) => ({
    default: m.MapEndpointsRoute,
  })),
);
const AntiAliasingDiagnostics = lazy(() =>
  import("@n-apt/routes/AntiAliasingDiagnostics").then((m) => ({
    default: m.AntiAliasingDiagnostics,
  })),
);
const PretextDemoRoute = lazy(() =>
  import("@n-apt/routes/PretextDemoRoute").then((m) => ({
    default: m.PretextDemoRoute,
  })),
);
const VFOGridDemoRoute = lazy(() =>
  import("@n-apt/routes/VFOGridDemoRoute").then((m) => ({
    default: m.VFOGridDemoRoute,
  })),
);
const TransformersRoute = lazy(() =>
  import("@n-apt/routes/TransformersRoute").then((m) => ({
    default: m.TransformersRoute,
  })),
);
const LegalDocumentRoute = lazy(() =>
  import("@n-apt/routes/LegalDocumentRoute").then((m) => ({
    default: m.LegalDocumentRoute,
  })),
);

import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { Model3DInteractionProvider as HotspotEditorProvider } from "@n-apt/hooks/useHotspotEditor";

import { DemodProvider, useDemod } from "@n-apt/contexts/DemodContext";
import { ReactFlowProvider } from "@xyflow/react";
import { MapLocationsProvider } from "@n-apt/hooks/useMapLocations";
import { MapRoutePathsProvider } from "@n-apt/hooks/useMapRoutePaths";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import {
  createNoteCardFromSpectrum,
  setNoteCardsCollapsed,
  useAppDispatch,
} from "@n-apt/redux";

const SpectrumRouteWithSidebar: React.FC<{
  activeTab: "visualizer" | "analysis" | "draw";
}> = ({ activeTab }) => {
  const dispatch = useAppDispatch();
  const fftCanvasRef = useRef<FFTCanvasHandle | null>(null);
  const [visualizerLoading, setVisualizerLoading] = useState(false);

  const handleCreateNoteCard = useCallback(() => {
    const snapshotData = fftCanvasRef.current?.getSnapshotData() ?? null;
    const snapshot = fftCanvasRef.current?.getCompositeSnapshot() ?? null;
    dispatch(setNoteCardsCollapsed(false));
    void dispatch(
      createNoteCardFromSpectrum({
        snapshot,
        stats: snapshotData
          ? {
              centerFrequencyHz: snapshotData.centerFrequencyHz,
              frequencyRange: snapshotData.frequencyRange,
            }
          : undefined,
      }),
    );
  }, [dispatch]);

  return (
    <MainLayout
      sidebar={
        <SpectrumSidebar
          onCreateNoteCard={handleCreateNoteCard}
          visualizerLoading={visualizerLoading}
        />
      }
    >
      <Suspense
        fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
      >
        <SpectrumRoute
          activeTab={activeTab}
          fftCanvasRef={fftCanvasRef}
          onLoadingStateChange={setVisualizerLoading}
        />
      </Suspense>
    </MainLayout>
  );
};

// Create a wrapper component to manage scanner state
const DemodRouteWithSidebar: React.FC = () => {
  const {
    windowSizeHz,
    setWindowSizeHz,
    stepSizeHz,
    setStepSizeHz,
    audioThreshold,
    setAudioThreshold,
    scanner,
    currentFreq,
    scanRange,
    startScan,
    stopScan,
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
      <Suspense
        fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
      >
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

const GlobalSpacePauseHandler: React.FC = () => {
  const { toggleVisualizerPause, state: liveState } = useSpectrumStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isInputFocused =
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        ) || (document.activeElement as HTMLElement)?.isContentEditable;

      if (isInputFocused) return;

      if (
        (event.code === "Space" ||
          event.key === " " ||
          event.key === "Spacebar") &&
        liveState.sourceMode === "live"
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleVisualizerPause();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [liveState.sourceMode, toggleVisualizerPause]);

  return null;
};

const AppRoutesInner: React.FC = () => {
  return (
    <>
      <GlobalSpacePauseHandler />
      <Routes>
        <Route
          path="/"
          element={<SpectrumRouteWithSidebar activeTab="visualizer" />}
        />
        <Route
          path="/visualizer"
          element={<SpectrumRouteWithSidebar activeTab="visualizer" />}
        />
        <Route path="/demodulate" element={<DemodRouteWithSidebar />} />
        <Route
          path="/draw-signal"
          element={
            <DrawSignalPaginationProvider>
              <MainLayout sidebar={<DrawSignalSidebar />}>
                <Suspense
                  fallback={
                    <RouteLoadingFallback>Loading…</RouteLoadingFallback>
                  }
                >
                  <DrawSignalRoute />
                </Suspense>
              </MainLayout>
            </DrawSignalPaginationProvider>
          }
        />
        <Route
          path="/3d-model"
          element={
            <MainLayout
              sidebar={
                process.env.NODE_ENV === "test" ? (
                  <TestRouteSidebar />
                ) : (
                  <Model3DSidebar />
                )
              }
            >
              <Suspense
                fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
              >
                <Model3DRoute />
              </Suspense>
            </MainLayout>
          }
        />
        <Route
          path="/map-endpoints"
          element={
            <MapRoutePathsProvider>
              <MainLayout sidebar={<MapEndpointsSidebar />}>
                <Suspense
                  fallback={
                    <RouteLoadingFallback>Loading…</RouteLoadingFallback>
                  }
                >
                  <MapEndpointsRoute />
                </Suspense>
              </MainLayout>
            </MapRoutePathsProvider>
          }
        />
        <Route
          path="/diagnostics/anti-aliasing"
          element={
            <MainLayout sidebar={<SDRTestSidebar />}>
              <Suspense
                fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
              >
                <AntiAliasingDiagnostics />
              </Suspense>
            </MainLayout>
          }
        />
        <Route
          path="/pretext-demo"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <PretextDemoRoute />
            </Suspense>
          }
        />
        <Route
          path="/vfo-grid-demo"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <VFOGridDemoRoute />
            </Suspense>
          }
        />
        <Route
          path="/transformers"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <TransformersRoute />
            </Suspense>
          }
        />
        <Route
          path="/terms"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <LegalDocumentRoute />
            </Suspense>
          }
        />
        <Route
          path="/privacy"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <LegalDocumentRoute />
            </Suspense>
          }
        />
        <Route
          path="/license"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <LegalDocumentRoute />
            </Suspense>
          }
        />
        <Route
          path="/responsible-use"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <LegalDocumentRoute />
            </Suspense>
          }
        />
      </Routes>
    </>
  );
};

export const AppRoutes: React.FC = () => {
  return (
    <DemodProvider>
      <ReactFlowProvider>
        <Model3DProvider>
          <HotspotEditorProvider>
            <MapLocationsProvider>
              <AppRoutesInner />
            </MapLocationsProvider>
          </HotspotEditorProvider>
        </Model3DProvider>
      </ReactFlowProvider>
    </DemodProvider>
  );
};

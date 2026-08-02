import React, { lazy, Suspense, useEffect, useState } from "react";
import { useCallback, useRef } from "react";
import styled from "styled-components";
import { Routes, Route, Navigate } from "react-router-dom";
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
const Model3DGalleryRoute = lazy(() =>
  import("@n-apt/routes/Model3DGalleryRoute").then((m) => ({
    default: m.Model3DGalleryRoute,
  })),
);
const LegalDocumentRoute = lazy(() =>
  import("@n-apt/routes/LegalDocumentRoute").then((m) => ({
    default: m.LegalDocumentRoute,
  })),
);
const LearnSignalsRoute = lazy(() =>
  import("@n-apt/routes/LearnSignalsRoute").then((m) => ({
    default: m.LearnSignalsRoute,
  })),
);
const IQCapturesRoute = lazy(() =>
  import("@n-apt/routes/IQCapturesRoute").then((m) => ({
    default: m.IQCapturesRoute,
  })),
);
const GetStartedRoute = lazy(() =>
  import("@n-apt/routes/GetStartedRoute").then((m) => ({
    default: m.GetStartedRoute,
  })),
);
const SettingsRoute = lazy(() =>
  import("@n-apt/routes/SettingsRoute").then((m) => ({
    default: m.SettingsRoute,
  })),
);
const FFTIFFTRoute = lazy(() =>
  import("@n-apt/routes/FFTIFFTRoute").then((m) => ({
    default: m.FFTIFFTRoute,
  })),
);
const FAQOverviewRoute = lazy(() =>
  import("@n-apt/routes/FAQOverviewRoute").then((m) => ({
    default: m.FAQOverviewRoute,
  })),
);
const CellularTriangulationTargetingDemoRoute = lazy(() =>
  import("@n-apt/tracked-interactive/Route").then((m) => ({
    default: m.CellularTriangulationTargetingDemoRoute,
  })),
);
const QuestionnaireRoute = lazy(() =>
  import("@n-apt/legal-app/routes/QuestionnaireRoute"),
);
const XArchiveFormatterRoute = lazy(() =>
  import("@n-apt/legal-app/routes/TranscriptFixerRoute"),
);

import { Model3DProvider } from "@n-apt/hooks/useModel3D";
import { LearnSignalsProvider } from "@n-apt/contexts/LearnSignalsContext";
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
  useAppSelector,
} from "@n-apt/redux";
import { selectSourceMode } from "@n-apt/redux/selectors/performanceSelectors";
import { NsaProgramToolsShell } from "@n-apt/legal-app/NsaProgramToolsShell";

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
  const { toggleVisualizerPause } = useSpectrumStore();
  const sourceMode = useAppSelector(selectSourceMode);

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
        sourceMode === "live"
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleVisualizerPause();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [sourceMode, toggleVisualizerPause]);

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
          path="/auth"
          element={<SpectrumRouteWithSidebar activeTab="visualizer" />}
        />
        <Route
          path="/visualizer"
          element={<SpectrumRouteWithSidebar activeTab="visualizer" />}
        />
        <Route
          path="/get-started"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <GetStartedRoute />
            </Suspense>
          }
        />
        <Route path="/demodulate" element={<DemodRouteWithSidebar />} />
        <Route
          path="/settings"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <SettingsRoute />
            </Suspense>
          }
        />
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
          path="/3d-model-gallery"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <Model3DGalleryRoute />
            </Suspense>
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
        <Route
          path="/learn-signals"
          element={
            <LearnSignalsProvider>
              <Suspense
                fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
              >
                <LearnSignalsRoute />
              </Suspense>
            </LearnSignalsProvider>
          }
        />
        <Route
          path="/faq"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <FAQOverviewRoute />
            </Suspense>
          }
        />
        <Route
          path="/faq/iq-captures"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <IQCapturesRoute />
            </Suspense>
          }
        />
        <Route
          path="/iq-captures"
          element={<Navigate to="/faq/iq-captures" replace />}
        />
        <Route
          path="/faq/fft-ifft"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <FFTIFFTRoute />
            </Suspense>
          }
        />
        <Route
          path="/fft-ifft"
          element={<Navigate to="/faq/fft-ifft" replace />}
        />
        <Route
          path="/game"
          element={
            <Suspense
              fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}
            >
              <CellularTriangulationTargetingDemoRoute />
            </Suspense>
          }
        />
        <Route
          path="/questionnaire"
          element={
            <NsaProgramToolsShell>
              <Suspense fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}>
                <QuestionnaireRoute />
              </Suspense>
            </NsaProgramToolsShell>
          }
        />
        <Route
          path="/x-archive-formatter"
          element={
            <NsaProgramToolsShell>
              <Suspense fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}>
                <XArchiveFormatterRoute />
              </Suspense>
            </NsaProgramToolsShell>
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

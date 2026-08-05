import React, { lazy, Suspense, useEffect, useState } from "react";
import { useCallback, useRef } from "react";
import styled from "styled-components";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { MainLayout } from "@n-apt/components/MainLayout";
import { SpectrumSidebar } from "@n-apt/components/sidebar/SpectrumSidebar";
import type { FFTCanvasHandle } from "@n-apt/components";

import { DrawSignalSidebar } from "@n-apt/components/sidebar/DrawSignalSidebar";
import { MapEndpointsSidebar } from "@n-apt/components/sidebar/MapEndpointsSidebar";
import { Model3DSidebar } from "@n-apt/components/sidebar/Model3DSidebar";
import { SDRTestSidebar } from "@n-apt/components/sidebar/SDRTestSidebar";
import { SettingsSidebar } from "@n-apt/components/sidebar/SettingsSidebar";

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
  import("@n-apt/framework/LearnSignalsRoute").then((m) => ({
    default: m.default,
  })),
);
const GetStartedRoute = lazy(() =>
  import("@n-apt/routes/GetStartedRoute").then((m) => ({
    default: m.default,
  })),
);
const SettingsRoute = lazy(() =>
  import("@n-apt/routes/SettingsRoute").then((m) => ({
    default: m.SettingsRoute,
  })),
);
const CellularTriangulationTargetingDemoRoute = lazy(() =>
  import("@n-apt/tracked-interactive/Route").then((m) => ({
    default: m.CellularTriangulationTargetingDemoRoute,
  })),
);
const QuestionnaireRoute = lazy(
  () => import("@n-apt/framework/QuestionnaireRoute"),
);
const XArchiveFormatterRoute = lazy(
  () => import("@n-apt/framework/XArchiveFormatterRoute"),
);

import {
  LazyDemodSidebarAdapter,
  RouteScopedProviders,
} from "@n-apt/routes/RouteScopedProviders";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import {
  createNoteCardFromSpectrum,
  setNoteCardsCollapsed,
  useAppDispatch,
  useAppSelector,
} from "@n-apt/redux";
import { selectSourceMode } from "@n-apt/redux/selectors/performanceSelectors";
import { useSettingsSectionScrollSpy } from "@n-apt/hooks/useSettingsSectionScrollSpy";

const SETTINGS_SECTIONS = [
  { id: "theme", label: "Theme" },
  { id: "sdr", label: "SDR Settings" },
  { id: "login", label: "Login" },
  { id: "iq-capture", label: "I/Q Capture Settings" },
  { id: "snapshot", label: "Snapshot & Fast Snapshot" },
];

const TestRouteSidebar: React.FC = () => <div data-testid="route-sidebar" />;

const RouteLoadingFallback = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  min-height: 60vh;
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

// ── Shared layout shell ─────────────────────────────────────────────────────
// One persistent MainLayout wraps every routed page. The sidebar is switched
// by the current path (never unmounted wholesale), so navigating between
// routes keeps the sidebar in place and only the content area swaps. The
// Suspense fallback also lives inside the content area so a lazy route chunk
// shows "Loading…" in the section only — not a full-app flash.
const AppShellLayout: React.FC = () => {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const fftCanvasRef = useRef<FFTCanvasHandle | null>(null);
  const [visualizerLoading, setVisualizerLoading] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const { activeSectionId, scrollToSection } = useSettingsSectionScrollSpy({
    containerRef: pageRef,
    sectionIds: SETTINGS_SECTIONS.map((s) => s.id),
  });

  const path = location.pathname;
  const isSpectrum = ["/", "/auth", "/visualizer"].includes(path);
  const isDemod = path === "/demodulate" || path === "/demod";
  const isSettings = path === "/settings";
  const is3DModel = path === "/3d-model";
  const isMap = path === "/map-endpoints";
  const isAntiAliasing = path === "/diagnostics/anti-aliasing";
  const isDrawSignal = path === "/draw-signal";

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

  let sidebar: React.ReactNode = null;
  if (isSpectrum) {
    sidebar = (
      <SpectrumSidebar
        onCreateNoteCard={handleCreateNoteCard}
        visualizerLoading={visualizerLoading}
      />
    );
  } else if (isDemod) {
    sidebar = <LazyDemodSidebarAdapter />;
  } else if (isSettings) {
    sidebar = (
      <SettingsSidebar
        sections={SETTINGS_SECTIONS}
        activeSectionId={activeSectionId}
        onSectionClick={scrollToSection}
      />
    );
  } else if (is3DModel) {
    sidebar =
      process.env.NODE_ENV === "test" ? <TestRouteSidebar /> : <Model3DSidebar />;
  } else if (isMap) {
    sidebar = <MapEndpointsSidebar />;
  } else if (isAntiAliasing) {
    sidebar = <SDRTestSidebar />;
  } else if (isDrawSignal) {
    sidebar = <DrawSignalSidebar />;
  }

  const content = (
    <Suspense fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}>
      <Routes>
        <Route
          path="/"
          element={
            <SpectrumRoute
              activeTab="visualizer"
              fftCanvasRef={fftCanvasRef}
              onLoadingStateChange={setVisualizerLoading}
            />
          }
        />
        <Route
          path="/auth"
          element={
            <SpectrumRoute
              activeTab="visualizer"
              fftCanvasRef={fftCanvasRef}
              onLoadingStateChange={setVisualizerLoading}
            />
          }
        />
        <Route
          path="/visualizer"
          element={
            <SpectrumRoute
              activeTab="visualizer"
              fftCanvasRef={fftCanvasRef}
              onLoadingStateChange={setVisualizerLoading}
            />
          }
        />
        <Route path="/get-started" element={<GetStartedRoute />} />
        <Route path="/demodulate" element={<DemodRoute />} />
        <Route path="/demod" element={<DemodRoute />} />
        <Route
          path="/settings"
          element={<SettingsRoute containerRef={pageRef} />}
        />
        <Route path="/draw-signal" element={<DrawSignalRoute />} />
        <Route path="/3d-model" element={<Model3DRoute />} />
        <Route path="/map-endpoints" element={<MapEndpointsRoute />} />
        <Route
          path="/diagnostics/anti-aliasing"
          element={<AntiAliasingDiagnostics />}
        />
        <Route path="/3d-model-gallery" element={<Model3DGalleryRoute />} />
        <Route path="/pretext-demo" element={<PretextDemoRoute />} />
        <Route path="/vfo-grid-demo" element={<VFOGridDemoRoute />} />
        <Route path="/transformers" element={<TransformersRoute />} />
        <Route path="/terms" element={<LegalDocumentRoute />} />
        <Route path="/privacy" element={<LegalDocumentRoute />} />
        <Route path="/license" element={<LegalDocumentRoute />} />
        <Route path="/responsible-use" element={<LegalDocumentRoute />} />
        <Route
          path="/learn-signals"
          element={<LearnSignalsRoute />}
        />
        <Route
          path="/learn-signals/:sectionSlug"
          element={<LearnSignalsRoute />}
        />
        <Route
          path="/faq"
          element={<Navigate to="/learn-signals" replace />}
        />
        <Route
          path="/faq/iq-captures"
          element={<Navigate to="/learn-signals/iq-captures" replace />}
        />
        <Route
          path="/iq-captures"
          element={<Navigate to="/learn-signals/iq-captures" replace />}
        />
        <Route
          path="/faq/fft-ifft"
          element={<Navigate to="/learn-signals/fft-ifft" replace />}
        />
        <Route
          path="/fft-ifft"
          element={<Navigate to="/learn-signals/fft-ifft" replace />}
        />
        <Route
          path="/game"
          element={<CellularTriangulationTargetingDemoRoute />}
        />
        <Route
          path="/questionnaire"
          element={<QuestionnaireRoute />}
        />
        <Route
          path="/x-archive-formatter"
          element={<XArchiveFormatterRoute />}
        />
      </Routes>
    </Suspense>
  );

  if (sidebar === null) {
    return content;
  }

  return <MainLayout sidebar={sidebar}>{content}</MainLayout>;
};

const AppRoutesInner: React.FC = () => {
  return (
    <>
      <GlobalSpacePauseHandler />
      <AppShellLayout />
    </>
  );
};

export const AppRoutes: React.FC = () => {
  return (
    <RouteScopedProviders>
      <AppRoutesInner />
    </RouteScopedProviders>
  );
};

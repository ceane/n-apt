import React, { lazy, Suspense, useEffect, useState } from "react";
import { useCallback, useRef } from "react";
import styled from "styled-components";
import { Navigate, Routes, Route, useLocation } from "react-router";
import { MainLayout } from "@n-apt/app/MainLayout";
import { LogoutRoute } from "@n-apt/app/routes/pages/LogoutRoute";
import { SpectrumSidebar } from "@n-apt/spectrum/sidebar/SpectrumSidebar";
import type { FFTCanvasHandle } from "@n-apt/spectrum";

import { DrawSignalSidebar } from "@n-apt/draw-signal/sidebar/DrawSignalSidebar";
import { MapEndpointsSidebar } from "@n-apt/maps/sidebar/MapEndpointsSidebar";
import { Model3DSidebar } from "@n-apt/three-d/sidebar/Model3DSidebar";
import { SDRTestSidebar } from "@n-apt/sdr-test/sidebar/SDRTestSidebar";
import { PreferencesSidebar } from "@n-apt/settings/sidebar/SettingsSidebar";

// Lazy load route components
const SpectrumRoute = lazy(() =>
  import("@n-apt/app/routes/pages/SpectrumRoute").then((m) => ({
    default: m.SpectrumRoute,
  })),
);
const DemodRoute = lazy(() =>
  preloadDemodRoute().then((m) => ({ default: m.DemodRoute })),
);
const DrawSignalRoute = lazy(() =>
  import("@n-apt/app/routes/pages/DrawSignalRoute").then((m) => ({
    default: m.DrawSignalRoute,
  })),
);
const Model3DRoute = lazy(() =>
  import("@n-apt/app/routes/pages/Model3DRoute").then((m) => ({
    default: m.Model3DRoute,
  })),
);
const MapEndpointsRoute = lazy(() =>
  import("@n-apt/app/routes/pages/MapEndpointsRoute").then((m) => ({
    default: m.MapEndpointsRoute,
  })),
);
const AntiAliasingDiagnostics = lazy(() =>
  import("@n-apt/app/routes/pages/AntiAliasingDiagnostics").then((m) => ({
    default: m.AntiAliasingDiagnostics,
  })),
);
const PretextDemoRoute = lazy(() =>
  import("@n-apt/app/routes/pages/PretextDemoRoute").then((m) => ({
    default: m.PretextDemoRoute,
  })),
);
const VFOGridDemoRoute = lazy(() =>
  import("@n-apt/app/routes/pages/VFOGridDemoRoute").then((m) => ({
    default: m.VFOGridDemoRoute,
  })),
);
const TransformersRoute = lazy(() =>
  import("@n-apt/app/routes/pages/TransformersRoute").then((m) => ({
    default: m.TransformersRoute,
  })),
);
const Model3DGalleryRoute = lazy(() =>
  import("@n-apt/app/routes/pages/Model3DGalleryRoute").then((m) => ({
    default: m.Model3DGalleryRoute,
  })),
);
const LegalDocumentRoute = lazy(() =>
  import("@n-apt/app/routes/pages/LegalDocumentRoute").then((m) => ({
    default: m.LegalDocumentRoute,
  })),
);
const LearnSignalsRoute = lazy(() =>
  import("@n-apt/app/routes/LearnSignalsRoute").then((m) => ({
    default: m.default,
  })),
);
const GetStartedRoute = lazy(() =>
  import("@n-apt/app/routes/pages/GetStartedRoute").then((m) => ({
    default: m.default,
  })),
);
const PreferencesRoute = lazy(() =>
  import("@n-apt/app/routes/pages/SettingsRoute").then((m) => ({
    default: m.PreferencesRoute,
  })),
);
const CellularTriangulationTargetingDemoRoute = lazy(() =>
  import("@n-apt/app-game/Route").then((m) => ({
    default: m.CellularTriangulationTargetingDemoRoute,
  })),
);
const QuestionnaireRoute = lazy(
  () => import("@n-apt/app/routes/QuestionnaireRoute"),
);
const XArchiveFormatterRoute = lazy(
  () => import("@n-apt/app/routes/XArchiveFormatterRoute"),
);

import {
  LazyDemodSidebarAdapter,
  preloadDemodRoute,
  RouteScopedProviders,
} from "@n-apt/app/routes/pages/RouteScopedProviders";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import {
  createNoteCardFromSpectrum,
  setNoteCardsCollapsed,
  useAppDispatch,
  useAppSelector,
} from "@n-apt/redux";
import { selectSourceMode } from "@n-apt/redux/selectors/performanceSelectors";
import { useSettingsSectionScrollSpy } from "@n-apt/settings/hooks/useSettingsSectionScrollSpy";
import { PREFERENCES_SECTIONS } from "@n-apt/settings/settingsSections";

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
  const path = location.pathname;
  const isPreferences = path === "/prefs";
  const requestedPreferencesSectionId = isPreferences
    ? new URLSearchParams(location.search).get("section")
    : null;
  const { activeSectionId, scrollToSection } = useSettingsSectionScrollSpy({
    containerRef: pageRef,
    sectionIds: PREFERENCES_SECTIONS.map((s) => s.id),
    requestedSectionId: requestedPreferencesSectionId,
  });

  const isSpectrum = ["/", "/auth", "/visualizer"].includes(path);
  const isDemod = path === "/demodulate" || path === "/demod";
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
  } else if (isPreferences) {
    sidebar = (
      <PreferencesSidebar
        sections={PREFERENCES_SECTIONS}
        activeSectionId={activeSectionId}
        onSectionClick={scrollToSection}
      />
    );
  } else if (is3DModel) {
    sidebar =
      process.env.NODE_ENV === "test" ? (
        <TestRouteSidebar />
      ) : (
        <Model3DSidebar />
      );
  } else if (isMap) {
    sidebar = <MapEndpointsSidebar />;
  } else if (isAntiAliasing) {
    sidebar = <SDRTestSidebar />;
  } else if (isDrawSignal) {
    sidebar = <DrawSignalSidebar />;
  }

  const content = (
    <Suspense fallback={<RouteLoadingFallback>Loading…</RouteLoadingFallback>}>
      {isDemod ? (
        // Framework mode already matched this pathname in its route manifest.
        // Do not ask a nested legacy <Routes> tree to match it again: under
        // React Router 8 that leaves the demod sidebar selected while the
        // visualizer content remains mounted.
        <DemodRoute />
      ) : (
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
            path="/prefs"
            element={<PreferencesRoute containerRef={pageRef} />}
          />
          <Route path="/settings" element={<Navigate to="/prefs" replace />} />
          <Route
            path="/extras"
            element={<Navigate to="/prefs?section=extras" replace />}
          />
          <Route path="/logout" element={<LogoutRoute />} />
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
          <Route path="/learn" element={<LearnSignalsRoute />} />
          <Route path="/learn/:id" element={<LearnSignalsRoute />} />
          <Route
            path="/game"
            element={<CellularTriangulationTargetingDemoRoute />}
          />
          <Route path="/questionnaire" element={<QuestionnaireRoute />} />
          <Route
            path="/x-archive-formatter"
            element={<XArchiveFormatterRoute />}
          />
        </Routes>
      )}
    </Suspense>
  );

  if (sidebar === null) {
    return content;
  }

  return (
    <MainLayout sidebar={sidebar} showRouteNavigation={!is3DModel}>
      {content}
    </MainLayout>
  );
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

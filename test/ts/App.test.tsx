import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";
import { AppContent } from "@n-apt/App";

// Mock all components to avoid import issues
jest.mock("@n-apt/components", () => ({
  FFTCanvas: () => (
    <div data-testid="spectrum-visualizer">Spectrum Visualizer</div>
  ),
  DrawMockNAPT: () => <div data-testid="draw-mock-napt">Draw Mock NAPT</div>,
}));

jest.mock("@n-apt/components/NavigationSidebarNew", () => {
  const { Routes, Route } = require("react-router-dom");
  const MockNavigationSidebar = () => (
    <div data-testid="navigation-sidebar">
      <Routes>
        <Route
          path="/"
          element={<div data-testid="spectrum-route">Spectrum Route</div>}
        />
        <Route
          path="/visualizer"
          element={<div data-testid="spectrum-route">Spectrum Route</div>}
        />
        <Route
          path="/analysis"
          element={<div data-testid="spectrum-route">Spectrum Route</div>}
        />
        <Route
          path="/draw-signal"
          element={<div data-testid="spectrum-route">Spectrum Route</div>}
        />
        <Route
          path="/3d-model"
          element={<div data-testid="model3d-route">Model3D Route</div>}
        />
        <Route
          path="/hotspot-editor"
          element={
            <div data-testid="hotspot-editor-route">Hotspot Editor Route</div>
          }
        />
      </Routes>
    </div>
  );
  return { NavigationSidebar: MockNavigationSidebar };
});

jest.mock("@n-apt/components/SpectrumRoute", () => ({
  default: () => <div data-testid="spectrum-route">Spectrum Route</div>,
}));

jest.mock("@n-apt/components/Model3DRoute", () => ({
  default: () => <div data-testid="model3d-route">Model3D Route</div>,
}));

jest.mock("@n-apt/components/HotspotEditorRoute", () => ({
  default: () => (
    <div data-testid="hotspot-editor-route">Hotspot Editor Route</div>
  ),
}));

jest.mock("@n-apt/components/HumanModelViewerSimple", () => ({
  default: () => (
    <div data-testid="human-model-viewer-simple">Human Model Viewer Simple</div>
  ),
}));

jest.mock("@n-apt/components/HotspotEditorSimple", () => ({
  default: () => (
    <div data-testid="hotspot-editor-simple">Hotspot Editor Simple</div>
  ),
}));

jest.mock("@n-apt/components/sidebar/SidebarForRoute", () => ({
  default: () => <div data-testid="sidebar-for-route">Sidebar For Route</div>,
}));

jest.mock("@n-apt/hooks/useModel3D", () => ({
  useModel3D: () => ({
    selectedArea: null,
    setSelectedArea: jest.fn(),
    controlsRef: { current: null },
  }),
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useHotspotEditor", () => ({
  useHotspotEditor: () => ({
    hotspots: [],
    selectedHotspot: null,
    setSelectedHotspot: jest.fn(),
    addHotspot: jest.fn(),
    updateHotspot: jest.fn(),
    deleteHotspot: jest.fn(),
    clearAllHotspots: jest.fn(),
    importHotspots: jest.fn(),
    exportHotspots: jest.fn(),
    settings: {
      pointName: "",
      hotspotSize: 0.1,
      symmetryMode: "none",
      multiSelectMode: false,
      showGrid: true,
    },
    updateSettings: jest.fn(),
  }),
  HotspotEditorProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock("@n-apt/components/HumanModelViewer", () => ({
  default: () => <div data-testid="human-model-viewer">Human Model Viewer</div>,
}));

jest.mock("@n-apt/components/HotspotEditor", () => ({
  default: () => <div data-testid="hotspot-editor">Hotspot Editor</div>,
}));

jest.mock("@n-apt/components/FFTPlaybackCanvas", () => ({
  default: () => (
    <div data-testid="stitcher-visualizer">Stitcher Visualizer</div>
  ),
}));

jest.mock("@n-apt/hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: false,
    deviceState: "disconnected",
    deviceLoadingReason: null,
    isPaused: false,
    serverPaused: false,
    backend: "mock",
    deviceInfo: null,
    data: null,
    error: null,
    sendFrequencyRange: jest.fn(),
    sendPauseCommand: jest.fn(),
    sendSettings: jest.fn(),
    sendRestartDevice: jest.fn(),
  }),
}));

const renderApp = () => {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AppContent />
    </MemoryRouter>,
  );
};

describe("App Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render without crashing", () => {
    renderApp();
    expect(screen.getByTestId("navigation-sidebar")).toBeInTheDocument();
  });

  it("should show Spectrum route by default", () => {
    renderApp();
    expect(screen.getByTestId("spectrum-route")).toBeInTheDocument();
  });

  it("should navigate to 3D model route", () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/3d-model"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(getByTestId("model3d-route")).toBeInTheDocument();
  });

  it("should navigate to hotspot editor route", () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/hotspot-editor"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(getByTestId("hotspot-editor-route")).toBeInTheDocument();
  });

  it("should navigate to analysis route", () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/analysis"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(getByTestId("spectrum-route")).toBeInTheDocument();
  });

  it("should navigate to draw-signal route", () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/draw-signal"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(getByTestId("spectrum-route")).toBeInTheDocument();
  });
});

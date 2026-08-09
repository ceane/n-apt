import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "@n-apt/app/routes/pages/Routes";
import { TestWrapper } from "./testUtils";

jest.mock("@n-apt/spectrum/sidebar/SpectrumSidebar", () => ({
  SpectrumSidebar: () => (
    <div data-testid="spectrum-sidebar">Spectrum Sidebar</div>
  ),
}));

jest.mock("@n-apt/app/MainLayout", () => ({
  MainLayout: ({
    children,
    sidebar,
  }: {
    children: React.ReactNode;
    sidebar: React.ReactNode;
  }) => (
    <div>
      <div data-testid="main-layout-sidebar">{sidebar}</div>
      <div data-testid="main-layout-content">{children}</div>
    </div>
  ),
}));

jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  SpectrumProvider: ({ children }: { children: React.ReactNode }) => children,
  useSpectrumStore: () => ({
    toggleVisualizerPause: jest.fn(),
    state: { sourceMode: "live" },
    wsConnection: {
      sendCaptureCommand: jest.fn(),
      sendScanCommand: jest.fn(),
      sendDemodulateCommand: jest.fn(),
    },
    effectiveFrames: [],
    effectiveSdrSettings: {},
  }),
}));

jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  DemodProvider: ({ children }: { children: React.ReactNode }) => children,
  useDemod: () => ({
    windowSizeHz: 0,
    setWindowSizeHz: jest.fn(),
    stepSizeHz: 0,
    setStepSizeHz: jest.fn(),
    audioThreshold: 0,
    setAudioThreshold: jest.fn(),
    scanner: { isScanning: false, scanProgress: 0, detectedRegions: [] },
    currentFreq: 0,
    scanRange: { start: 0, end: 0 },
    startScan: jest.fn(),
    stopScan: jest.fn(),
  }),
}));

jest.mock("@n-apt/demodulation/sidebar/DemodulateSidebar", () => ({
  DemodulateSidebar: () => <div data-testid="route-sidebar">Route Sidebar</div>,
}));

jest.mock("@n-apt/draw-signal/sidebar/DrawSignalSidebar", () => ({
  DrawSignalSidebar: () => (
    <div data-testid="draw-signal-sidebar">Draw Signal Sidebar</div>
  ),
}));

jest.mock("@n-apt/maps/sidebar/MapEndpointsSidebar", () => ({
  MapEndpointsSidebar: () => (
    <div data-testid="map-endpoints-sidebar">Map Endpoints Sidebar</div>
  ),
}));

jest.mock("@n-apt/three-d/sidebar/Model3DSidebar", () => ({
  Model3DSidebar: () => <div data-testid="route-sidebar">Route Sidebar</div>,
}));

jest.mock("@n-apt/sdr-test/sidebar/SDRTestSidebar", () => ({
  SDRTestSidebar: () => <div data-testid="route-sidebar">Route Sidebar</div>,
}));

jest.mock("@n-apt/app/routes/pages/SpectrumRoute", () => ({
  __esModule: true,
  SpectrumRoute: () => <div data-testid="spectrum-route">Spectrum Route</div>,
}));

jest.mock("@n-apt/app/routes/pages/DemodRoute", () => ({
  __esModule: true,
  DemodRoute: () => <div data-testid="demod-route">Demod Route</div>,
}));

jest.mock("@n-apt/app/routes/pages/DrawSignalRoute", () => ({
  __esModule: true,
  DrawSignalRoute: () => (
    <div data-testid="draw-signal-route">Draw Signal Route</div>
  ),
}));

jest.mock("@n-apt/app/routes/pages/Model3DRoute", () => ({
  __esModule: true,
  Model3DRoute: () => <div data-testid="model3d-route">Model 3D Route</div>,
}));

jest.mock("@n-apt/app/routes/pages/MapEndpointsRoute", () => ({
  __esModule: true,
  MapEndpointsRoute: () => (
    <div data-testid="map-endpoints-route">Map Endpoints Route</div>
  ),
}));

jest.mock("@n-apt/app/routes/pages/AntiAliasingDiagnostics", () => ({
  __esModule: true,
  AntiAliasingDiagnostics: () => (
    <div data-testid="anti-aliasing-route">Anti Aliasing Route</div>
  ),
}));

jest.mock("@n-apt/app/routes/pages/PretextDemoRoute", () => ({
  __esModule: true,
  PretextDemoRoute: () => <div data-testid="pretext-route">Pretext Route</div>,
}));

jest.mock("@n-apt/app/routes/pages/VFOGridDemoRoute", () => ({
  __esModule: true,
  VFOGridDemoRoute: () => <div data-testid="vfo-route">VFO Route</div>,
}));

jest.mock("@n-apt/app/routes/pages/TransformersRoute", () => ({
  __esModule: true,
  TransformersRoute: () => (
    <div data-testid="transformers-route">Transformers Route</div>
  ),
}));

describe("AppRoutes auth regression", () => {
  it("renders the main app view at /auth after login", async () => {
    render(
      <TestWrapper>
        <MemoryRouter initialEntries={["/auth"]}>
          <AppRoutes />
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(await screen.findByTestId("spectrum-route")).toBeInTheDocument();
    expect(screen.getByTestId("spectrum-sidebar")).toBeInTheDocument();
  });
});

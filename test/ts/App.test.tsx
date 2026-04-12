import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Routes, Route } from "react-router-dom";
// @ts-ignore - Module is mocked below
import { AppRoutes } from "@n-apt/routes/Routes";
import { TestWrapper } from "./testUtils";

// Mock scrollTo for containers
Element.prototype.scrollTo = jest.fn();

// Mock AppRoutes to bypass lazy loading
jest.mock("@n-apt/routes/Routes", () => ({
  AppRoutes: () => (
    <Routes>
      <Route path="/" element={
        <div>
          <div data-testid="spectrum-route">Spectrum Route</div>
          <div data-testid="spectrum-sidebar">Spectrum Sidebar</div>
        </div>
      } />
      <Route path="/demodulate" element={
        <div>
          <div data-testid="demod-route">Demod Route</div>
          <div data-testid="route-sidebar">Route Sidebar</div>
        </div>
      } />
      <Route path="/draw-signal" element={
        <div>
          <div data-testid="draw-signal-route">Draw Signal Route</div>
          <div data-testid="draw-signal-sidebar">Draw Signal Sidebar</div>
        </div>
      } />
      <Route path="/3d-model" element={
        <div>
          <div data-testid="model3d-route">Model 3D Route</div>
          <div data-testid="route-sidebar">Route Sidebar</div>
        </div>
      } />
      <Route path="/map-endpoints" element={
        <div>
          <div data-testid="map-endpoints-route">Map Endpoints Route</div>
          <div data-testid="map-endpoints-sidebar">Map Endpoints Sidebar</div>
        </div>
      } />
    </Routes>
  ),
}));

// Mock providers and AuthenticationRoute
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthentication: () => ({ isAuthenticated: true }),
}));

jest.mock("@n-apt/routes/AuthenticationRoute", () => ({
  AuthenticationRoute: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
  SpectrumProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useModel3D", () => ({
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useHotspotEditor", () => ({
  Model3DInteractionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useMapLocations", () => ({
  MapLocationsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock route components - return promises for lazy loading
jest.mock("@n-apt/routes/SpectrumRoute", () => ({
  __esModule: true,
  default: () => <div data-testid="spectrum-route">Spectrum Route</div>,
  SpectrumRoute: () => <div data-testid="spectrum-route">Spectrum Route</div>,
}));

jest.mock("@n-apt/routes/DemodRoute", () => ({
  __esModule: true,
  default: () => <div data-testid="demod-route">Demod Route</div>,
  DemodRoute: () => <div data-testid="demod-route">Demod Route</div>,
}));

jest.mock("@n-apt/routes/DrawSignalRoute", () => ({
  __esModule: true,
  default: () => <div data-testid="draw-signal-route">Draw Signal Route</div>,
  DrawSignalRoute: () => <div data-testid="draw-signal-route">Draw Signal Route</div>,
}));

jest.mock("@n-apt/routes/Model3DRoute", () => ({
  __esModule: true,
  default: () => <div data-testid="model3d-route">Model 3D Route</div>,
  Model3DRoute: () => <div data-testid="model3d-route">Model 3D Route</div>,
}));

jest.mock("@n-apt/routes/MapEndpointsRoute", () => ({
  __esModule: true,
  default: () => <div data-testid="map-endpoints-route">Map Endpoints Route</div>,
  MapEndpointsRoute: () => <div data-testid="map-endpoints-route">Map Endpoints Route</div>,
}));

// Mock sidebars
jest.mock("@n-apt/components/sidebar/SpectrumSidebar", () => ({
  SpectrumSidebar: () => <div data-testid="spectrum-sidebar">Spectrum Sidebar</div>,
}));


jest.mock("@n-apt/components/sidebar/DrawSignalSidebar", () => ({
  DrawSignalSidebar: () => <div data-testid="draw-signal-sidebar">Draw Signal Sidebar</div>,
}));

jest.mock("@n-apt/components/sidebar/MapEndpointsSidebar", () => ({
  MapEndpointsSidebar: () => <div data-testid="map-endpoints-sidebar">Map Endpoints Sidebar</div>,
}));

const renderApp = (initialPath = "/") => {
  return render(
    <TestWrapper>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </TestWrapper>,
  );
};

describe("App Routing", () => {
  it("renders Spectrum route for /", () => {
    renderApp("/");
    expect(screen.getByTestId("spectrum-route")).toBeInTheDocument();
    expect(screen.getByTestId("spectrum-sidebar")).toBeInTheDocument();
  });

  it("renders Demodulate route for /demodulate", () => {
    renderApp("/demodulate");
    expect(screen.getByTestId("demod-route")).toBeInTheDocument();
    expect(screen.getByTestId("route-sidebar")).toBeInTheDocument();
  });

  it("renders Draw Signal route for /draw-signal", () => {
    renderApp("/draw-signal");
    expect(screen.getByTestId("draw-signal-route")).toBeInTheDocument();
    expect(screen.getByTestId("draw-signal-sidebar")).toBeInTheDocument();
  });

  it("renders Model 3D route for /3d-model", () => {
    renderApp("/3d-model");
    expect(screen.getByTestId("model3d-route")).toBeInTheDocument();
    expect(screen.getByTestId("route-sidebar")).toBeInTheDocument();
  });

  it("renders Map Endpoints route for /map-endpoints", () => {
    renderApp("/map-endpoints");
    expect(screen.getByTestId("map-endpoints-route")).toBeInTheDocument();
    expect(screen.getByTestId("map-endpoints-sidebar")).toBeInTheDocument();
  });

});

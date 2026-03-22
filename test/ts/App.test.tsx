import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "@n-apt/routes/Routes";
import { TestWrapper } from "./testUtils";

// Mock scrollTo for containers
Element.prototype.scrollTo = jest.fn();

// Mock providers and AuthRoute
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthentication: () => ({ isAuthenticated: true }),
}));

jest.mock("@n-apt/routes/AuthRoute", () => ({
  AuthRoute: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
  SpectrumProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useModel3D", () => ({
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useHotspotEditor", () => ({
  HotspotEditorProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@n-apt/hooks/useMapLocations", () => ({
  MapLocationsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock route components
jest.mock("@n-apt/routes/SpectrumRoute", () => ({
  SpectrumRoute: () => <div data-testid="spectrum-route">Spectrum Route</div>,
}));


jest.mock("@n-apt/routes/DrawSignalRoute", () => ({
  DrawSignalRoute: () => <div data-testid="draw-signal-route">Draw Signal Route</div>,
}));

jest.mock("@n-apt/routes/Model3DRoute", () => ({
  Model3DRoute: () => <div data-testid="model3d-route">Model 3D Route</div>,
}));

jest.mock("@n-apt/routes/MapEndpointsRoute", () => ({
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

jest.mock("@n-apt/components/sidebar/SidebarForRoute", () => ({
  SidebarForRoute: () => <div data-testid="route-sidebar">Route Sidebar</div>,
}));

const theme = {
  primary: "#00d4ff",
  primaryAlpha: "rgba(0, 212, 255, 0.2)",
  primaryAnchor: "rgba(0, 212, 255, 0.1)",
  background: "#000",
  text: "#fff",
};

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

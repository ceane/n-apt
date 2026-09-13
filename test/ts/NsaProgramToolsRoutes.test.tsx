import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "@n-apt/app/routes/pages/Routes";

jest.mock("@n-apt/app-legal/routes/QuestionnaireRoute", () => ({
  __esModule: true,
  default: () => <h1>Questionnaire</h1>,
}));
jest.mock("@n-apt/app-legal/routes/TranscriptFixerRoute", () => ({
  __esModule: true,
  default: () => <h1>X Archive Formatter</h1>,
}));
jest.mock("@n-apt/app/MainLayout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
jest.mock("@n-apt/spectrum/sidebar/SpectrumSidebar", () => ({ SpectrumSidebar: () => null }));
jest.mock("@n-apt/demodulation/sidebar/DemodulateSidebar", () => ({ DemodulateSidebar: () => null }));
jest.mock("@n-apt/draw-signal/sidebar/DrawSignalSidebar", () => ({ DrawSignalSidebar: () => null }));
jest.mock("@n-apt/maps/sidebar/MapEndpointsSidebar", () => ({ MapEndpointsSidebar: () => null }));
jest.mock("@n-apt/three-d/sidebar/Model3DSidebar", () => ({ Model3DSidebar: () => null }));
jest.mock("@n-apt/sdr-test/sidebar/SDRTestSidebar", () => ({ SDRTestSidebar: () => null }));
jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({ state: { sourceMode: "live" }, toggleVisualizerPause: jest.fn() }),
}));
jest.mock("@n-apt/redux", () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => "live",
  createNoteCardFromSpectrum: jest.fn(),
  setNoteCardsCollapsed: jest.fn(),
}));
jest.mock("@n-apt/redux/selectors/performanceSelectors", () => ({
  selectSourceMode: jest.fn(),
}));

jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  DemodProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@n-apt/three-d/hooks/useModel3D", () => ({
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@n-apt/three-d/hooks/useHotspotEditor", () => ({
  Model3DInteractionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@n-apt/maps/hooks/useMapLocations", () => ({
  MapLocationsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@n-apt/maps/hooks/useMapRoutePaths", () => ({
  MapRoutePathsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("NSA program tool routes", () => {
  it.each([
    ["/questionnaire", "Questionnaire"],
    ["/x-archive-formatter", "X Archive Formatter"],
  ])("renders %s directly with the program-tools sidebar", async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Program tools" })).toBeInTheDocument();
  });
});

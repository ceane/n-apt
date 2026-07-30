import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "@n-apt/routes/Routes";

jest.mock("@n-apt/legal-app/routes/QuestionnaireRoute", () => ({
  __esModule: true,
  default: () => <h1>Questionnaire</h1>,
}));
jest.mock("@n-apt/legal-app/routes/TranscriptFixerRoute", () => ({
  __esModule: true,
  default: () => <h1>X Archive Formatter</h1>,
}));
jest.mock("@n-apt/components/MainLayout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
jest.mock("@n-apt/components/sidebar/SpectrumSidebar", () => ({ SpectrumSidebar: () => null }));
jest.mock("@n-apt/components/sidebar/DemodulateSidebar", () => ({ DemodulateSidebar: () => null }));
jest.mock("@n-apt/components/sidebar/DrawSignalSidebar", () => ({ DrawSignalSidebar: () => null }));
jest.mock("@n-apt/components/sidebar/MapEndpointsSidebar", () => ({ MapEndpointsSidebar: () => null }));
jest.mock("@n-apt/components/sidebar/Model3DSidebar", () => ({ Model3DSidebar: () => null }));
jest.mock("@n-apt/components/sidebar/SDRTestSidebar", () => ({ SDRTestSidebar: () => null }));
jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
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

jest.mock("@n-apt/contexts/DemodContext", () => ({
  DemodProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
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
jest.mock("@n-apt/hooks/useMapRoutePaths", () => ({
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

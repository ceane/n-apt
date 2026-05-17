const React = require("react");
const { render, screen, waitFor, act } = require("@testing-library/react");
const { Provider } = require("react-redux");
const { configureStore } = require("@reduxjs/toolkit");
require("@testing-library/jest-dom");

const jestGlobal = typeof jest !== "undefined" ? jest : undefined;
declare const vi: any;
const viGlobal = typeof vi !== "undefined" ? vi : undefined;
const mockApi = jestGlobal?.mock ?? viGlobal?.mock;
if (!mockApi) {
  throw new Error("Test mock API is not available");
}

mockApi("../../src/ts/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ isAuthenticated: true }),
  AuthProvider: ({ children }: any) => <>{children}</>,
}));
mockApi("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ isAuthenticated: true }),
  AuthProvider: ({ children }: any) => <>{children}</>,
}));

const mockWsConnection = {
  sendCaptureCommand: jestGlobal?.fn?.() ?? viGlobal?.fn?.() ?? (() => {}),
  sendScanCommand: jestGlobal?.fn?.() ?? viGlobal?.fn?.() ?? (() => {}),
  sendDemodulateCommand: jestGlobal?.fn?.() ?? viGlobal?.fn?.() ?? (() => {}),
};

mockApi("@n-apt/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    state: { activeSignalArea: "A" },
    wsConnection: mockWsConnection,
  }),
  SpectrumProvider: ({ children }: any) => <>{children}</>,
}));

const { DemodProvider, useDemod } = require("../../src/ts/contexts/DemodContext");

const mockStore = configureStore({
  reducer: {
    websocket: (_state = { captureStatus: null, isPaused: false }, _action: any) => ({
      captureStatus: null,
      isPaused: false,
    }),
    demod: (_state = { isListening: false, algorithm: "fm", centerFreqHz: 0, bandwidthKhz: 0 }, _action: any) => ({
      isListening: false,
      algorithm: "fm",
      centerFreqHz: 0,
      bandwidthKhz: 0,
    }),
    waterfall: (_state = { activePlaybackMetadata: null, sourceMode: "live" }, _action: any) => ({
      activePlaybackMetadata: null,
      sourceMode: "live",
    }),
    spectrum: (_state = { frequencyRange: null, lastKnownRanges: {}, sampleRateHz: 48000, vizZoom: 1, vizPanOffset: 0 }, _action: any) => ({
      frequencyRange: null,
      lastKnownRanges: {},
      sampleRateHz: 48000,
      vizZoom: 1,
      vizPanOffset: 0,
    }),
  },
});

const TestComponent = () => {
  const { analysisSession, startAnalysis, clearAnalysis } = useDemod();

  React.useEffect(() => {
    startAnalysis("apt", false, 5.0, "test script", "test media", [1, 2, 3]);
    return () => clearAnalysis();
  }, [startAnalysis, clearAnalysis]);

  return (
    <div data-testid="apt-test">
      <div data-testid="analysis-state">{analysisSession.state}</div>
      <div data-testid="analysis-type">{analysisSession.type || "none"}</div>
      <div data-testid="apt-progress">{analysisSession.aptProgress || 0}</div>
      <div data-testid="apt-stage">{analysisSession.aptStage || "none"}</div>
      <div data-testid="script-content">
        {analysisSession.scriptContent || "none"}
      </div>
      <div data-testid="media-content">
        {analysisSession.mediaContent || "none"}
      </div>
      <button onClick={clearAnalysis} data-testid="clear-btn">
        Clear
      </button>
    </div>
  );
};

describe("APT Analysis", () => {
  beforeAll(() => {
    jestGlobal?.setTimeout?.(15000);
  });

  it("should initialize APT analysis with correct parameters", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("capturing");
    expect(screen.getByTestId("analysis-type")).toHaveTextContent("apt");
    expect(screen.getByTestId("script-content")).toHaveTextContent(
      "test script",
    );
    expect(screen.getByTestId("media-content")).toHaveTextContent("test media");
  });

  it("should progress through APT analysis stages", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("apt-progress")).toHaveTextContent("0.2");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("apt-stage")).toHaveTextContent(
          "subcarrier_isolation",
        );
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("analysis-state")).toHaveTextContent(
          "result",
        );
        expect(screen.getByTestId("apt-progress")).toHaveTextContent("1");
        expect(screen.getByTestId("apt-stage")).toHaveTextContent("completed");
      },
      { timeout: 10000 },
    );
  }, 15000);

  it("should clear analysis when requested", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("analysis-state")).toHaveTextContent(
          "result",
        );
      },
      { timeout: 10000 },
    );

    await act(async () => {
      screen.getByTestId("clear-btn").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("analysis-state")).toHaveTextContent("idle");
    });
  }, 15000);
});

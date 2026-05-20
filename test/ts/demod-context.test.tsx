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
  beforeEach(() => {
    if (jestGlobal) jestGlobal.useFakeTimers();
    else if (viGlobal) viGlobal.useFakeTimers();
  });

  afterEach(() => {
    if (jestGlobal) jestGlobal.useRealTimers();
    else if (viGlobal) viGlobal.useRealTimers();
  });

  const flushMicrotasks = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("should initialize APT analysis with correct parameters", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    await flushMicrotasks();

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

    await flushMicrotasks();

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("capturing");

    // Advance 3 seconds for countdown
    act(() => {
      if (jestGlobal) jestGlobal.advanceTimersByTime(3000);
      else if (viGlobal) viGlobal.advanceTimersByTime(3000);
    });

    // Advance 500ms for first tick of progress
    act(() => {
      if (jestGlobal) jestGlobal.advanceTimersByTime(500);
      else if (viGlobal) viGlobal.advanceTimersByTime(500);
    });

    expect(screen.getByTestId("apt-progress")).toHaveTextContent("0.2");
    expect(screen.getByTestId("apt-stage")).toHaveTextContent(
      "subcarrier_isolation",
    );

    // Advance 2000ms for remaining ticks to complete
    act(() => {
      if (jestGlobal) jestGlobal.advanceTimersByTime(2000);
      else if (viGlobal) viGlobal.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("result");
    expect(screen.getByTestId("apt-progress")).toHaveTextContent("1");
    expect(screen.getByTestId("apt-stage")).toHaveTextContent("completed");
  });

  it("should clear analysis when requested", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    await flushMicrotasks();

    // Advance to completed state
    act(() => {
      if (jestGlobal) jestGlobal.advanceTimersByTime(5500);
      else if (viGlobal) viGlobal.advanceTimersByTime(5500);
    });

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("result");

    act(() => {
      screen.getByTestId("clear-btn").click();
    });

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("idle");
  });
});

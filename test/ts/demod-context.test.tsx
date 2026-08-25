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

mockApi("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ isAuthenticated: true }),
  AuthProvider: ({ children }: any) => <>{children}</>,
}));
mockApi("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ isAuthenticated: true }),
  AuthProvider: ({ children }: any) => <>{children}</>,
}));

const mockWsConnection = {
  sendCaptureCommand: jestGlobal?.fn?.() ?? viGlobal?.fn?.() ?? (() => {}),
  sendScanCommand: jestGlobal?.fn?.() ?? viGlobal?.fn?.() ?? (() => {}),
  sendDemodulateCommand: jestGlobal?.fn?.() ?? viGlobal?.fn?.() ?? (() => {}),
};

mockApi("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    state: { activeSignalArea: "A" },
    wsConnection: mockWsConnection,
  }),
  SpectrumProvider: ({ children }: any) => <>{children}</>,
}));

const {
  DemodProvider,
  useDemod,
} = require("@n-apt/demodulation/context/DemodContext");

const mockStore = configureStore({
  reducer: {
    websocket: (
      _state = { captureStatus: null, isPaused: false },
      _action: any,
    ) => ({
      captureStatus: null,
      isPaused: false,
    }),
    demod: (
      _state = {
        isListening: false,
        algorithm: "fm",
        centerFreqHz: 0,
        bandwidthKhz: 0,
      },
      _action: any,
    ) => ({
      isListening: false,
      algorithm: "fm",
      centerFreqHz: 0,
      bandwidthKhz: 0,
    }),
    waterfall: (
      _state = { activePlaybackMetadata: null, sourceMode: "live" },
      _action: any,
    ) => ({
      activePlaybackMetadata: null,
      sourceMode: "live",
    }),
    spectrum: (
      _state = {
        frequencyRange: null,
        lastKnownRanges: {},
        sampleRateHz: 48000,
        vizZoom: 1,
        vizPanOffset: 0,
      },
      _action: any,
    ) => ({
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
    if (mockWsConnection.sendCaptureCommand.mock) {
      mockWsConnection.sendCaptureCommand.mockClear();
    }
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

  it("should request a real reference capture immediately", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    await flushMicrotasks();

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("starting");
    expect(screen.getByTestId("analysis-type")).toHaveTextContent("apt");
    expect(screen.getByTestId("script-content")).toHaveTextContent(
      "test script",
    );
    expect(screen.getByTestId("media-content")).toHaveTextContent("test media");
    expect(mockWsConnection.sendCaptureCommand).toHaveBeenCalledTimes(1);
    const command = mockWsConnection.sendCaptureCommand.mock.calls[0]?.[0];
    expect(command?.jobId).toMatch(/^ref_apt_/);
    expect(command?.encrypted).toBe(true);
  });

  it("should transition to analyzing after the requested duration", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>,
    );

    await flushMicrotasks();

    act(() => {
      if (jestGlobal) jestGlobal.advanceTimersByTime(5500);
      else if (viGlobal) viGlobal.advanceTimersByTime(5500);
    });

    expect(screen.getByTestId("analysis-state")).toHaveTextContent(
      "analyzing",
    );
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

    act(() => {
      screen.getByTestId("clear-btn").click();
    });

    expect(screen.getByTestId("analysis-state")).toHaveTextContent("idle");
  });
});

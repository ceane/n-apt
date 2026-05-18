import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { THEME_TOKENS } from "@n-apt/consts";
import { SDRTestSidebar } from "@n-apt/components/sidebar/SDRTestSidebar";
import { SpectrumProvider, INITIAL_SPECTRUM_STATE } from "@n-apt/hooks/useSpectrumStore";
import { TestWrapper } from "./testUtils";

// Mock Lucide icons
jest.mock("lucide-react", () => ({
  Unplug: () => <div data-testid="unplug-icon" />,
  ChevronsLeftRightEllipsis: () => <div data-testid="chevrons-icon" />,
  RotateCcw: () => <div data-testid="rotate-icon" />,
  Pause: () => <div data-testid="pause-icon" />,
  Play: () => <div data-testid="play-icon" />,
  ChevronDown: () => <div data-testid="chevron-down" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  Settings: () => <div data-testid="settings-icon" />,
  Cpu: () => <div data-testid="cpu-icon" />,
  Activity: () => <div data-testid="activity-icon" />,
  BarChart2: () => <div data-testid="barchart-icon" />,
  Layers: () => <div data-testid="layers-icon" />,
  Radio: () => <div data-testid="radio-icon" />,
  Zap: () => <div data-testid="zap-icon" />,
  Info: () => <div data-testid="info-icon" />,
  Mic: () => <div data-testid="mic-icon" />,
  Volume2: () => <div data-testid="volume-icon" />,
}));

// Mock sub-components to keep it isolated
jest.mock("@n-apt/components/sidebar/SignalDisplaySection", () => ({
  SignalDisplaySection: () => <div data-testid="signal-display-section" />,
}));
jest.mock("@n-apt/components/SignalComposition", () => ({
  __esModule: true,
  default: () => <div data-testid="signal-composition" />,
}));
jest.mock("@n-apt/components/sidebar/SourceSettingsSection", () => ({
  SourceSettingsSection: () => <div data-testid="source-settings-section" />,
}));
jest.mock("@n-apt/components/sidebar/ConnectionStatusSection", () => ({
  ConnectionStatusSection: ({ extraActions }: any) => (
    <div data-testid="connection-status-section">{extraActions}</div>
  ),
  PauseButton: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
jest.mock("@n-apt/components/sidebar/SourceInput", () => ({
  __esModule: true,
  default: () => <div data-testid="source-input" />,
}));
jest.mock("@n-apt/components/sidebar/Channels", () => ({
  Channels: () => <div data-testid="channels" />,
}));
jest.mock("@n-apt/components/ui/Collapsible", () => ({
  SidebarSectionTitle: ({ title }: any) => <div>{title}</div>,
}));
jest.mock("@n-apt/components/ui", () => ({
  usePrompt: () => ({ showPrompt: jest.fn() }),
  Slider: () => <div data-testid="slider" />,
}));

describe("SDRTestSidebar", () => {
  const mockDispatch = jest.fn();
  
  const defaultMockValue = {
    state: INITIAL_SPECTRUM_STATE,
    dispatch: mockDispatch,
    fftVisualizerMachine: {} as any,
    manualVisualizerPaused: false,
    setManualVisualizerPaused: jest.fn(),
    effectiveFrames: [],
    effectiveSdrSettings: null,
    sampleRateHzEffective: 3200000,
    signalAreaBounds: null,
    lastSentPauseRef: { current: null },
    wsConnection: {
      isConnected: true,
      deviceState: "connected" as const,
      deviceLoadingReason: null,
      isPaused: false,
      serverPaused: false,
      backend: "mock",
      deviceInfo: "Mock Device",
      deviceName: "Mock Device",
      deviceProfile: null,
      maxSampleRateHz: 3200000,
      sampleRateOptions: [3200000],
      sampleRateHz: 3200000,
      sdrSettings: null,
      sdrLimitMarkers: [],
      dataRef: { current: null },
      spectrumFrames: [],
      captureStatus: { status: "started" as const, progress: 0, jobId: "test-job" },
      autoFftOptions: null,
      error: null,
      cryptoCorrupted: false,
      sendFrequencyRange: jest.fn(),
      sendPauseCommand: jest.fn(),
      sendSettings: jest.fn(),
      sendRestartDevice: jest.fn(),
      sendCaptureCommand: jest.fn(),
      sendScanCommand: jest.fn(),
      sendDemodulateCommand: jest.fn(),
      sendTrainingCommand: jest.fn(),
      sendGetAutoFftOptions: jest.fn(),
      sendPowerScaleCommand: jest.fn(),
    },
    toggleVisualizerPause: jest.fn(),
    cryptoCorrupted: false,
    deviceName: "Mock Device",
    deviceProfile: null,
  };

  const renderComponent = (mockValue = defaultMockValue) => {
    return render(
      <TestWrapper>
        <SpectrumProvider mockValue={mockValue}>
          <SDRTestSidebar />
        </SpectrumProvider>
      </TestWrapper>
    );
  };

  it("renders correctly", () => {
    renderComponent();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Run Multi-Frame Capture")).toBeInTheDocument();
  });

  it("triggers diagnostic on button click", () => {
    renderComponent();
    const button = screen.getByText("Run Multi-Frame Capture");
    fireEvent.click(button);
    expect(mockDispatch).toHaveBeenCalledWith({ type: "TRIGGER_DIAGNOSTIC" });
  });

  it("shows diagnostic status when running", () => {
    const runningMockValue = {
      ...defaultMockValue,
      state: {
        ...INITIAL_SPECTRUM_STATE,
        isDiagnosticRunning: true,
        diagnosticStatus: "Capturing data...",
      },
    };
    renderComponent(runningMockValue);
    expect(screen.getByText("Capturing data...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Capturing data\.\.\./ })).toBeDisabled();
  });

  it("shows 'Run Again' when capture is complete", () => {
    const completeMockValue = {
      ...defaultMockValue,
      state: {
        ...INITIAL_SPECTRUM_STATE,
        diagnosticStatus: "Capture complete",
      },
    };
    renderComponent(completeMockValue);
    expect(screen.getByText("Run Again")).toBeInTheDocument();
  });
});

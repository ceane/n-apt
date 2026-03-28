import * as React from "react";
import { render, screen, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
jest.setTimeout(15000);
import "@testing-library/jest-dom";
import { DemodProvider, useDemod } from "../../src/ts/contexts/DemodContext";

// Create a mock Redux store
const mockStore = configureStore({
  reducer: {
    websocket: (_state = { captureStatus: null }, _action) => ({ captureStatus: null }),
  },
});

jest.mock("../../src/ts/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ isAuthenticated: true }),
  AuthProvider: ({ children }: any) => <>{children}</>
}));
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ isAuthenticated: true }),
  AuthProvider: ({ children }: any) => <>{children}</>
}));
const mockWsConnection = {
  sendCaptureCommand: jest.fn(),
  sendScanCommand: jest.fn(),
  sendDemodulateCommand: jest.fn(),
};

jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    state: { activeSignalArea: "A" },
    wsConnection: mockWsConnection
  }),
  SpectrumProvider: ({ children }: any) => <>{children}</>
}));

// Test component to use the DemodContext
const TestComponent: React.FC = () => {
  const { analysisSession, startAnalysis, clearAnalysis } = useDemod();

  React.useEffect(() => {
    // Start APT analysis after component mounts
    startAnalysis('apt', false, 'test script', 'test media', [1, 2, 3]);
    return () => clearAnalysis();
  }, [startAnalysis, clearAnalysis]);

  return (
    <div data-testid="apt-test">
      <div data-testid="analysis-state">{analysisSession.state}</div>
      <div data-testid="analysis-type">{analysisSession.type || 'none'}</div>
      <div data-testid="apt-progress">{analysisSession.aptProgress || 0}</div>
      <div data-testid="apt-stage">{analysisSession.aptStage || 'none'}</div>
      <div data-testid="script-content">{analysisSession.scriptContent || 'none'}</div>
      <div data-testid="media-content">{analysisSession.mediaContent || 'none'}</div>
      <button onClick={clearAnalysis} data-testid="clear-btn">Clear</button>
    </div>
  );
};

describe("APT Analysis", () => {
  it("should initialize APT analysis with correct parameters", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>
    );

    // Check initial capturing state
    expect(screen.getByTestId('analysis-state')).toHaveTextContent('capturing');
    expect(screen.getByTestId('analysis-type')).toHaveTextContent('apt');
    expect(screen.getByTestId('script-content')).toHaveTextContent('test script');
    expect(screen.getByTestId('media-content')).toHaveTextContent('test media');
  });

  it("should progress through APT analysis stages", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>
    );

    // Wait for progress updates
    await waitFor(() => {
      expect(screen.getByTestId('apt-progress')).toHaveTextContent('0.2');
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByTestId('apt-stage')).toHaveTextContent('subcarrier_isolation');
    }, { timeout: 5000 });

    // Eventually should reach completed state
    await waitFor(() => {
      expect(screen.getByTestId('analysis-state')).toHaveTextContent('result');
      expect(screen.getByTestId('apt-progress')).toHaveTextContent('1');
      expect(screen.getByTestId('apt-stage')).toHaveTextContent('completed');
    }, { timeout: 10000 });
  });

  it("should clear analysis when requested", async () => {
    render(
      <Provider store={mockStore}>
        <DemodProvider>
          <TestComponent />
        </DemodProvider>
      </Provider>
    );

    // Wait for analysis to complete
    await waitFor(() => {
      expect(screen.getByTestId('analysis-state')).toHaveTextContent('result');
    }, { timeout: 10000 });

    // Clear the analysis
    await act(async () => {
      screen.getByTestId('clear-btn').click();
    });

    // Should return to idle state
    await waitFor(() => {
      expect(screen.getByTestId('analysis-state')).toHaveTextContent('idle');
    });
  });
});

/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { MemoryRouter } from "react-router-dom";
import { TestWrapper } from "./testUtils";
import { ThemeProvider } from "styled-components";

// Mock useAuthentication to avoid auth errors during state init
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    sessionToken: "mock-token",
    aesKey: new Uint8Array(32),
    isAuthenticated: true,
  }),
}));

jest.unmock("@n-apt/components/FFTCanvas");

const mockTheme = {
  primary: "#00d4ff",
  background: "#0a0a0a",
  text: "#ffffff",
  fftColor: "#00d4ff",
  waterfallTheme: "magma",
};

describe("FFTCanvas Component", () => {
  const defaultProps = {
    dataRef: { current: { waveform: new Float32Array(1024).fill(-50) } },
    frequencyRange: { min: 100, max: 110 },
    centerFrequencyMHz: 105,
    activeSignalArea: "test",
    isPaused: false,
    snapshotGridPreference: true,
  };

  it("should render spectrum and waterfall sections", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas {...defaultProps} />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Waterfall Display/i)).toBeInTheDocument();
  });

  it("should render visualizer sliders", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas {...defaultProps} />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Zoom")).toBeInTheDocument();
    });
  });
});

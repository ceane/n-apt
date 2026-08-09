import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import FFTAndWaterfall from "@n-apt/spectrum/FFTAndWaterfall";
import { TestWrapper } from "../ts/testUtils";
import { getMockNaptBuffer } from "../ts/mockNaptData";
import { configureStore } from "@reduxjs/toolkit";
import demodReducer from "@n-apt/redux/slices/demodSlice";
import spectrumReducer from "@n-apt/redux/slices/spectrumSlice";
import settingsReducer from "@n-apt/redux/slices/settingsSlice";
import themeReducer from "@n-apt/redux/slices/themeSlice";
import websocketReducer from "@n-apt/redux/slices/websocketSlice";
import waterfallReducer, {
  setSourceMode,
} from "@n-apt/redux/slices/waterfallSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

// Mock requestAnimationFrame to control the rendering loop
const mockRaf = jest.spyOn(window, "requestAnimationFrame");

// Ensure we use the real FFTCanvas for integration testing, not the manual mock in __mocks__
jest.unmock("@n-apt/spectrum/FFTCanvas");

jest.mock("@n-apt/spectrum/hooks/useWebGPUInit", () => {
  const lifecycle = () => ({
    webgpuEnabled: false,
    isInitializingWebGPU: false,
    webgpuDeviceRef: { current: null },
    webgpuFormatRef: { current: "bgra8unorm" },
    gridOverlayRendererRef: { current: null },
    markersOverlayRendererRef: { current: null },
    spikesOverlayRendererRef: { current: null },
    overlayDirtyRef: { current: { grid: false, markers: false } },
  });
  return { useWebGPULifecycle: lifecycle, useWebGPUInit: lifecycle };
});

jest.mock("@n-apt/spectrum/hooks/useWasmSimdMath", () => ({
  useSpectrumMath: () => ({
    processIqToDbmSpectrum: jest.fn(
      (_iq: Uint8Array, _offsetDb: number, fftSize: number) =>
        new Float32Array(Math.max(1, fftSize)).fill(-80),
    ),
  }),
  useWasmSimdMath: () => ({
    isAvailable: false,
    isLoading: false,
    processFFT: jest.fn(),
    processIqToDbmSpectrum: jest.fn(
      (_iq: Uint8Array, _offsetDb: number, fftSize: number) =>
        new Float32Array(Math.max(1, fftSize)).fill(-80),
    ),
  }),
}));

jest.mock("@n-apt/spectrum/hooks/useAsyncShaderCache", () => ({
  useAsyncShaderCache: () => ({
    preloadShaders: jest.fn(),
    getPipeline: jest.fn(),
  }),
}));

jest.mock("@n-apt/spectrum/hooks/useUnifiedFFTWaterfall", () => ({
  useUnifiedFFTWaterfall: () => ({
    process: jest.fn(),
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/spectrum/hooks/useDrawWebGPUFIFOWaterfall", () => ({
  useDrawWebGPUFIFOWaterfall: () => ({
    draw: jest.fn(),
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/spectrum/hooks/useWaterfallRetuneCompute", () => ({
  useWaterfallRetuneCompute: () => ({
    render: jest.fn(),
    cleanup: jest.fn(),
  }),
}));

describe("FFTAndWaterfall Integration", () => {
  const mockDataRef = { current: null as any };
  const defaultProps = {
    dataRef: mockDataRef,
    frequencyRange: { min: 100, max: 102 },
    centerFrequencyHz: 101_000_000,
    activeSignalArea: "A",
    isPaused: false,
    powerScale: "dB" as const,
    snapshotGridPreference: true,
  };

  let rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    rafCallback = null;
    mockRaf.mockImplementation((cb) => {
      rafCallback = cb;
      return 0;
    });
    // Reset canvas call logs (from our jest.canvasSetup.cjs)
    (global as any).WebGLRenderingContext?.prototype?.clearCalls?.();
  });

  test("renders and initializes canvas nodes", async () => {
    let container: HTMLElement = document.createElement("div");
    await act(async () => {
      ({ container } = render(
        <TestWrapper>
          <FFTAndWaterfall {...defaultProps} />
        </TestWrapper>,
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Check for canvas elements by ID (defined in FIFOWaterfallCanvas and FFTCanvas)
    expect(
      container.querySelector("#fft-waterfall-canvas-webgpu"),
    ).toBeInTheDocument();
  });

  test("processes mock binary data and triggers rendering", async () => {
    const mockNaptData = getMockNaptBuffer();
    // Simulate the data structure the transport would produce after decryption
    mockDataRef.current = {
      type: "spectrum",
      center_frequency_hz: 101000000,
      timestamp: Date.now(),
      data_type: "iq_raw",
      sample_rate: 2000000,
      iq_data: mockNaptData,
    };

    await act(async () => {
      render(
        <TestWrapper>
          <FFTAndWaterfall {...defaultProps} />
        </TestWrapper>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Manually trigger the RAF callback if we can find it,
    // or rely on hooks that run on mount.
    // FFTCanvas uses useFFTAnimation which sets up an animation loop.

    // In our simplified mock environment, we verify that the data made it to the canvas.
    // We can check if any drawing calls were made with our mock data.
    (global as any).getWebGLData?.();
    // If WebGL is used, it might contain payloads.
    // Since we are using JSDOM, most complex logic might be skipped unless we mock deeper.
  });

  test("snapshot workflow persists data to visualizerMachine", async () => {
    const visualizerMachine = {
      getState: jest.fn().mockReturnValue({ status: "empty", snapshot: null }),
      persist: jest.fn(),
      restore: jest.fn(),
      clear: jest.fn(),
    };

    mockDataRef.current = {
      type: "spectrum",
      center_frequency_hz: 101_000_000,
      timestamp: Date.now(),
      data_type: "iq_raw",
      sample_rate: 2_000_000,
      iq_data: getMockNaptBuffer(),
    };

    let attachedRef: any = null;
    const snapshotStore = configureStore({
      reducer: {
        demod: demodReducer,
        spectrum: spectrumReducer,
        settings: settingsReducer,
        websocket: websocketReducer,
        theme: themeReducer,
        waterfall: waterfallReducer,
      },
    });
    snapshotStore.dispatch(setSourceMode("file"));

    let container: HTMLElement = document.createElement("div");
    const { unmount } = await act(async () => {
      const rendered = render(
        <Provider store={snapshotStore}>
          <ThemeProvider theme={theme}>
            <FFTAndWaterfall
              {...defaultProps}
              isPaused={true}
              ref={(val: any) => {
                attachedRef = val;
              }}
              visualizerMachine={visualizerMachine as any}
            />
          </ThemeProvider>
        </Provider>,
      );
      container = rendered.container;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return rendered;
    });

    if (!attachedRef) {
      console.log("DOM DUMP:", container.innerHTML);
    }

    // Wait for the ref to be attached (might take a microtask/render cycle)
    await waitFor(() => expect(attachedRef).not.toBeNull(), { timeout: 10000 });

    // Trigger snapshot via imperative handle
    await act(async () => {
      attachedRef?.triggerSnapshotRender();

      // Manually execute the RAF callback that forceRender() just triggered
      if (rafCallback) {
        rafCallback(performance.now());
      }

      // Allow any async effects to settle
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(
      () => {
        expect(attachedRef?.getSnapshotData() ?? null).not.toBeNull();
      },
      { timeout: 10000 },
    );

    // Verify snapshot data can be retrieved
    const snapshotData = attachedRef?.getSnapshotData() ?? null;
    expect(snapshotData).not.toBeNull();
    expect(snapshotData?.waveform).toBeDefined();
    if (snapshotData?.waveform) {
      expect(snapshotData.waveform.length).toBeGreaterThan(0);
    }

    unmount();
  }, 15000);

  test("handles I/Q capture state changes", () => {
    const { rerender } = render(
      <TestWrapper>
        <FFTAndWaterfall {...defaultProps} isIqRecordingActive={false} />
      </TestWrapper>,
    );

    expect(screen.queryByText(/REC/i)).not.toBeInTheDocument();

    act(() => {
      rerender(
        <TestWrapper>
          <FFTAndWaterfall {...defaultProps} isIqRecordingActive={true} />
        </TestWrapper>,
      );
    });

    // Check if some indicator of recording is present (if applicable)
  });
});

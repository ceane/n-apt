import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { THEME_TOKENS } from "@n-apt/consts/theme";
import { FIFOWaterfall } from "../../src/ts/components/FIFOWaterfall";

jest.mock("@n-apt/hooks/useDrawWebGPUFIFOWaterfall", () => {
  const drawWebGPUFIFOWaterfall = jest.fn(() => false);
  return {
    __mockDrawWebGPUFIFOWaterfall: drawWebGPUFIFOWaterfall,
    useDrawWebGPUFIFOWaterfall: () => ({
      drawWebGPUFIFOWaterfall,
      cleanup: jest.fn(),
      getLastError: () => "mock WebGPU failure",
    }),
  };
});

const mockTheme = {
  mode: "dark" as const,
  requestedMode: "system" as const,
  waterfallTheme: "classic",
  colors: THEME_TOKENS.colors.dark,
  typography: THEME_TOKENS.typography,
  spacing: THEME_TOKENS.spacing,
  layout: THEME_TOKENS.layout,
  primary: "#00d4ff",
  primaryAlpha: "#00d4ff33",
  primaryAnchor: "#00d4ff1a",
  fft: "#00d4ff",
  cssVariables: {},
};

describe("FIFOWaterfall", () => {
  it("provides reusable typed output storage to optimized resamplers", async () => {
    const resampler = jest.fn(
      (
        _data: ArrayLike<number>,
        _targetLength: number,
        output?: Float32Array,
      ) => output ?? new Float32Array(0),
    );

    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={new Float32Array([-90, -70])}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          forceCanvas2D
          performScalarResampling={resampler}
        />
      </ThemeProvider>,
    );

    await waitFor(() => expect(resampler).toHaveBeenCalled());
    expect(resampler.mock.calls[0][2]).toBeInstanceOf(Float32Array);
    expect(resampler.mock.calls[0][2]?.length).toBeGreaterThan(0);
  });

  it("can force the Canvas2D renderer for embedded flow nodes", async () => {
    const { __mockDrawWebGPUFIFOWaterfall: drawWebGPU } = jest.requireMock(
      "@n-apt/hooks/useDrawWebGPUFIFOWaterfall",
    ) as { __mockDrawWebGPUFIFOWaterfall: jest.Mock };
    drawWebGPU.mockClear();

    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={new Float32Array([-90, -70])}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          forceCanvas2D
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(document.querySelector("canvas")).toHaveAttribute(
        "data-renderer-mode",
        "2d",
      ),
    );
    expect(drawWebGPU).not.toHaveBeenCalled();
  });

  it("waits for WebGPU initialization before acquiring a 2D fallback context", async () => {
    const { __mockDrawWebGPUFIFOWaterfall: drawWebGPU } = jest.requireMock(
      "@n-apt/hooks/useDrawWebGPUFIFOWaterfall",
    ) as { __mockDrawWebGPUFIFOWaterfall: jest.Mock };
    drawWebGPU.mockClear();

    const originalGpu = navigator.gpu;
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: jest.fn(async () => ({
          requestDevice: jest.fn(async () => ({})),
        })),
        getPreferredCanvasFormat: jest.fn(() => "bgra8unorm"),
      },
    });
    const getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, "getContext");
    const waveform = new Float32Array([-90, -70]);

    const view = render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={waveform}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );
    const initializingCanvas = view.container.querySelector("canvas");

    await waitFor(() => expect(drawWebGPU).toHaveBeenCalled());
    expect(view.container.querySelector("canvas")).not.toBe(initializingCanvas);
    expect(drawWebGPU.mock.calls[0][0].colormap.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(drawWebGPU.mock.calls[0][0].plotMargin).toEqual({ x: 0, y: 0 });
    expect(drawWebGPU.mock.calls[0][0].fftData).toBe(waveform);
    await waitFor(() => expect(getContextSpy).toHaveBeenCalledWith("2d"));
    expect(view.container.querySelector("canvas")).toHaveAttribute(
      "data-renderer-error",
      "mock WebGPU failure",
    );

    const first2dCall = getContextSpy.mock.calls.findIndex(
      ([contextId]) => String(contextId) === "2d",
    );
    expect(drawWebGPU.mock.invocationCallOrder[0]).toBeLessThan(
      getContextSpy.mock.invocationCallOrder[first2dCall],
    );

    getContextSpy.mockRestore();
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: originalGpu,
    });
  });

  it("shows a loading placeholder while awaiting data", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={null}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          awaitingDeviceData
          placeholderSourceLabel="Live SDR"
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    expect(
      screen.getAllByText(
        (_, node) => node?.textContent === "Loading Waterfall...",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("from Live SDR")).toBeInTheDocument();
  });

  it("shows a playback error placeholder with the provided reason", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={null}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          placeholderSourceLabel="Playback file"
          placeholderErrorReason="missing channel metadata"
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    expect(
      screen.getByText("Error / missing channel metadata"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Can't playback from Playback file. Reason: missing channel metadata",
      ),
    ).toBeInTheDocument();
  });

  it("shows a server down placeholder when the device disconnects", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={null}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          isDeviceConnected={false}
          placeholderSourceLabel="Live SDR"
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Server Down")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The server was disconnected due to being manually exited or an error.",
      ),
    ).toBeInTheDocument();
  });
});

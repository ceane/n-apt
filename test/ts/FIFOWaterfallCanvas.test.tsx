import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FIFOWaterfallCanvas from "@n-apt/spectrum/FIFOWaterfallCanvas";
import { ThemeProvider } from "styled-components";
import { THEME_TOKENS } from "@n-apt/consts/theme";

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

describe("FIFOWaterfallCanvas", () => {
  it("does not add standby text to the waterfall header", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={false}
          isStandby={true}
          setWaterfallGpuCanvasNode={jest.fn()}
          setWaterfallOverlayCanvasNode={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
    expect(screen.queryByText("Waterfall Display (Standby)")).not.toBeInTheDocument();
  });

  it("renders the paused bar without inline paused text", () => {
    const setWaterfallGpuCanvasNode = jest.fn();
    const setWaterfallOverlayCanvasNode = jest.fn();

    const { container } = render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={true}
          setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
          setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
    expect(screen.queryByText(/\(Paused\)/i)).not.toBeInTheDocument();
    expect(
      container.querySelector("#fft-waterfall-canvas-webgpu"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("#fft-waterfall-canvas-overlay"),
    ).toBeInTheDocument();
    expect(setWaterfallGpuCanvasNode).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
    );
    expect(setWaterfallOverlayCanvasNode).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
    );
  });

  it("shows a loading placeholder with a source label while awaiting data", () => {
    const setWaterfallGpuCanvasNode = jest.fn();
    const setWaterfallOverlayCanvasNode = jest.fn();

    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={false}
          setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
          setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
          awaitingDeviceData
          placeholderSourceLabel="Playback capture"
        />
      </ThemeProvider>,
    );

    expect(
      screen.getAllByText(
        (_, node) => node?.textContent === "Loading Waterfall...",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("from Playback capture")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the first frame to arrive."),
    ).toBeInTheDocument();
  });

  it("cleans up ref callbacks on unmount", () => {
    const setWaterfallGpuCanvasNode = jest.fn();
    const setWaterfallOverlayCanvasNode = jest.fn();

    const { unmount } = render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={false}
          setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
          setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
        />
      </ThemeProvider>,
    );

    unmount();

    expect(
      setWaterfallGpuCanvasNode.mock.calls[
        setWaterfallGpuCanvasNode.mock.calls.length - 1
      ]?.[0],
    ).toBeNull();
    expect(
      setWaterfallOverlayCanvasNode.mock.calls[
        setWaterfallOverlayCanvasNode.mock.calls.length - 1
      ]?.[0],
    ).toBeNull();
  });
});

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FIFOWaterfallCanvas from "@n-apt/components/FIFOWaterfallCanvas";
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
  it("renders the paused title, all waterfall layers, and heterodyning highlights", () => {
    const setWaterfallGpuCanvasNode = jest.fn();
    const setWaterfallOverlayCanvasNode = jest.fn();

    const { container } = render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={true}
          setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
          setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
          heterodyningHighlightedBins={[
            { start: 0.1, end: 0.2 },
            { start: 0.7, end: 0.9 },
          ]}
        />
      </ThemeProvider>,
    );

    expect(
      screen.getByText(/Waterfall Display \(Paused\)/i),
    ).toBeInTheDocument();
    expect(
      container.querySelector("#fft-waterfall-canvas-webgpu"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("#fft-waterfall-canvas-overlay"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("fifo-waterfall-highlight-band")).toHaveLength(
      2,
    );
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

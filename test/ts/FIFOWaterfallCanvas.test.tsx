import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FIFOWaterfallCanvas from "@n-apt/components/FIFOWaterfallCanvas";
import { ThemeProvider } from "styled-components";

const mockTheme = {
  background: "#0a0a0a",
  canvasBorder: "#1f2937",
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

    expect(screen.getByText(/Waterfall Display \(Paused\)/i)).toBeInTheDocument();
    expect(container.querySelector("#fft-waterfall-canvas-webgpu")).toBeInTheDocument();
    expect(container.querySelector("#fft-waterfall-canvas-overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId("fifo-waterfall-highlight-band")).toHaveLength(2);
    expect(setWaterfallGpuCanvasNode).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
    );
    expect(setWaterfallOverlayCanvasNode).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
    );
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

    expect(setWaterfallGpuCanvasNode.mock.calls.at(-1)?.[0]).toBeNull();
    expect(setWaterfallOverlayCanvasNode.mock.calls.at(-1)?.[0]).toBeNull();
  });
});

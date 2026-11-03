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
  it("blends the non-hardware pattern over the waterfall signal", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={false}
          setWaterfallGpuCanvasNode={jest.fn()}
          setWaterfallOverlayCanvasNode={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("fft-waterfall-pattern-overlay")).toHaveStyle({
      mixBlendMode: "difference",
    });
  });

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
    expect(
      screen.queryByText("Waterfall Display (Standby)"),
    ).not.toBeInTheDocument();
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

  it("clears the overlay without resetting its 2D canvas transform", () => {
    const clearRect = jest.fn();
    const dimensionSetters: jest.SpyInstance[] = [];
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function (
        this: HTMLCanvasElement,
        contextId: string,
      ) {
        if (this.id === "fft-waterfall-canvas-overlay" && contextId === "2d") {
          return { clearRect } as unknown as CanvasRenderingContext2D;
        }
        return null;
      } as never);

    try {
      render(
        <ThemeProvider theme={mockTheme}>
          <FIFOWaterfallCanvas
            isPaused={false}
            setWaterfallGpuCanvasNode={jest.fn()}
            setWaterfallOverlayCanvasNode={(canvas) => {
              if (canvas) {
                dimensionSetters.push(
                  jest.spyOn(canvas, "width", "set"),
                  jest.spyOn(canvas, "height", "set"),
                );
              }
            }}
            placeholderState={{ kind: "error", reason: "Server down" }}
          />
        </ThemeProvider>,
      );

      const overlay = screen.getByTestId(
        "fft-waterfall-pattern-overlay",
      ) as HTMLCanvasElement;
      expect(clearRect).toHaveBeenCalledWith(
        0,
        0,
        overlay.width,
        overlay.height,
      );
      expect(dimensionSetters).toHaveLength(2);
      expect(dimensionSetters[0]).not.toHaveBeenCalled();
      expect(dimensionSetters[1]).not.toHaveBeenCalled();
    } finally {
      dimensionSetters.forEach((setter) => setter.mockRestore());
      getContext.mockRestore();
    }
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

  it("does not rebind canvas nodes forever when the placeholder object changes", () => {
    const setWaterfallGpuCanvasNode = jest.fn();
    const setWaterfallOverlayCanvasNode = jest.fn();
    const { rerender } = render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={false}
          setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
          setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
          placeholderState={{ kind: "error", reason: "Device disconnected" }}
        />
      </ThemeProvider>,
    );

    const initialGpuCalls = setWaterfallGpuCanvasNode.mock.calls.length;
    rerender(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfallCanvas
          isPaused={false}
          setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
          setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
          placeholderState={{ kind: "error", reason: "Device disconnected" }}
        />
      </ThemeProvider>,
    );

    expect(setWaterfallGpuCanvasNode.mock.calls.length).toBe(initialGpuCalls);
    expect(setWaterfallOverlayCanvasNode.mock.calls.length).toBe(
      initialGpuCalls,
    );
  });
});

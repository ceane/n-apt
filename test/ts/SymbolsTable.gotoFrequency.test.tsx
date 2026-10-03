/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { Provider } from "react-redux";
import { SymbolsTable } from "@n-apt/demodulation/react-flow/nodes/SymbolsTable";
import { resolveClosestSampleIndex } from "@n-apt/demodulation/react-flow/nodes/tableLayout";
import { liveFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import { createTestStore } from "./testUtils";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const FREQUENCY_RANGE = { min: 100_000_000, max: 101_000_000 };

// The grid only renders rows once it has a measured height.
let reportHeight = 0;
class MockResizeObserver {
  cb: (entries: any[]) => void;
  constructor(cb: (entries: any[]) => void) {
    this.cb = cb;
  }
  observe() {
    this.cb([{ contentRect: { width: 1200, height: reportHeight } }]);
  }
  disconnect() {}
}
(global as any).ResizeObserver = MockResizeObserver;

let pendingFrames: Map<number, FrameRequestCallback>;
let nextFrameId = 1;
// The table's rAF loop rate-limits on the timestamp rAF hands it, so the mock
// advances a virtual clock that a real display would advance for us.
let frameTime = 1_000_000;

const installRafMock = () => {
  pendingFrames = new Map();
  frameTime = 1_000_000;
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, cb);
      return id;
    });
  jest
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id: number) => {
      pendingFrames.delete(id);
    });
};

const fireAllFrames = () => {
  let guard = 0;
  while (pendingFrames.size > 0 && guard < 16) {
    const next = pendingFrames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!next) break;
    pendingFrames.delete(next[0]);
    frameTime += 1000 / 60;
    next[1](frameTime);
    guard += 1;
  }
};

const renderTable = () => {
  const store = createTestStore();
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <SymbolsTable frequencyRange={FREQUENCY_RANGE} />
      </ThemeProvider>
    </Provider>,
  );
};

describe("resolveClosestSampleIndex", () => {
  const base = {
    rangeMinHz: 100_000_000,
    stepPerSampleHz: 1_000,
    sampleCount: 1_000,
  };

  it("resolves an exact frequency to its sample index", () => {
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 100_000_000 }),
    ).toBe(0);
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 100_400_000 }),
    ).toBe(400);
  });

  it("rounds to the closest sample for in-between frequencies", () => {
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 100_000_400 }),
    ).toBe(0);
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 100_000_600 }),
    ).toBe(1);
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 100_000_500 }),
    ).toBe(1);
  });

  it("clamps frequencies outside the range to the nearest edge sample", () => {
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 90_000_000 }),
    ).toBe(0);
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: 200_000_000 }),
    ).toBe(999);
  });

  it("returns null when a sample grid cannot be formed", () => {
    expect(
      resolveClosestSampleIndex({
        ...base,
        stepPerSampleHz: 0,
        frequencyHz: 100_000_000,
      }),
    ).toBeNull();
    expect(
      resolveClosestSampleIndex({
        ...base,
        sampleCount: 0,
        frequencyHz: 100_000_000,
      }),
    ).toBeNull();
    expect(
      resolveClosestSampleIndex({ ...base, frequencyHz: Number.NaN }),
    ).toBeNull();
  });
});

describe("SymbolsTable go-to-frequency", () => {
  beforeEach(() => {
    reportHeight = 0;
    window.localStorage.clear();
    installRafMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    liveFrameRuntime.ref.current = null;
  });

  it("opens the editor, jumps to the exact sample, and reports it", () => {
    renderTable();

    expect(screen.queryByText("Go To Frequency")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to frequency" }));
    expect(screen.getByText("Go To Frequency")).toBeInTheDocument();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);

    expect(screen.getByText(/SAMPLE 1 \//)).toBeInTheDocument();
    expect(screen.getByText("100.0MHz")).toBeInTheDocument();
    expect(screen.getByText(/· exact/)).toBeInTheDocument();
  });

  it("reports the offset when the request falls between samples", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Go to frequency" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "100.0003" } });
    fireEvent.blur(input);

    expect(screen.getByText(/SAMPLE 2 \//)).toBeInTheDocument();
    expect(screen.getByText(/Δ/)).toBeInTheDocument();
  });

  it("clamps an out-of-range request to the nearest sample", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Go to frequency" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);

    expect(screen.getByText(/SAMPLE 1 \//)).toBeInTheDocument();
  });

  it("closes the editor when the toggle is pressed again", () => {
    renderTable();

    const toggle = screen.getByRole("button", { name: "Go to frequency" });
    fireEvent.click(toggle);
    expect(screen.getByText("Go To Frequency")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Go To Frequency")).not.toBeInTheDocument();
  });
});

describe("SymbolsTable frame updates", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installRafMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    liveFrameRuntime.ref.current = null;
    reportHeight = 0;
  });

  it("renders rows and re-renders them when a new frame lands", () => {
    reportHeight = 400;
    liveFrameRuntime.ref.current = {
      iq_data: new Uint8Array(2048 * 2).fill(0),
    } as any;

    renderTable();
    act(() => {
      fireAllFrames();
    });

    expect(screen.getAllByText("(-, -)").length).toBeGreaterThan(0);

    liveFrameRuntime.ref.current = {
      iq_data: new Uint8Array(2048 * 2).fill(255),
    } as any;
    act(() => {
      fireAllFrames();
    });

    expect(screen.getAllByText("(+, +)").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("(-, -)").length).toBe(0);
  });

  it("does not re-render when the frame slot is unchanged", () => {
    reportHeight = 400;
    const frame = { iq_data: new Uint8Array(2048 * 2).fill(0) };
    liveFrameRuntime.ref.current = frame as any;

    const { container } = renderTable();
    act(() => {
      fireAllFrames();
    });

    const before = container.querySelectorAll(".symbols-row").length;
    const htmlBefore = container.innerHTML;

    act(() => {
      fireAllFrames();
    });

    expect(container.innerHTML).toBe(htmlBefore);
    expect(before).toBeGreaterThan(0);
  });
});

describe("SymbolsTable update-rate toggle", () => {
  beforeEach(() => {
    reportHeight = 0;
    window.localStorage.clear();
    installRafMock();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    liveFrameRuntime.ref.current = null;
  });

  it("shows the app frame rate by default and flips to 250ms polling", () => {
    renderTable();

    const toggle = screen.getByRole("button", { name: "Update rate" });
    expect(toggle).toHaveTextContent("60fps");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("250ms");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("60fps");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("persists the chosen mode across remounts", () => {
    const first = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Update rate" }));

    expect(window.localStorage.getItem("n-apt.symbols-update-mode.v1")).toBe(
      "poll",
    );

    first.unmount();
    renderTable();
    expect(
      screen.getByRole("button", { name: "Update rate" }),
    ).toHaveTextContent("250ms");
  });

  it("keeps updating from the shared clock while polling", () => {
    jest.useFakeTimers();
    reportHeight = 400;
    liveFrameRuntime.ref.current = {
      iq_data: new Uint8Array(2048 * 2).fill(0),
    } as any;

    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Update rate" }));

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getAllByText("(-, -)").length).toBeGreaterThan(0);

    liveFrameRuntime.ref.current = {
      iq_data: new Uint8Array(2048 * 2).fill(255),
    } as any;

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getAllByText("(+, +)").length).toBeGreaterThan(0);
  });
});

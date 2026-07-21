/** @jest-environment jsdom */
import React from "react";

// Mock OffscreenCanvas for JSDOM
if (typeof window !== "undefined" && !window.OffscreenCanvas) {
  (window as any).OffscreenCanvas = class {
    constructor() {}
    getContext() {
      return {
        clearRect: jest.fn(),
        fillRect: jest.fn(),
        fillText: jest.fn(),
        stroke: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        measureText: jest.fn().mockReturnValue({ width: 0 }),
        save: jest.fn(),
        restore: jest.fn(),
        setLineDash: jest.fn(),
      };
    }
  };
}
const mockUseNodes = jest.fn((): any[] => []);
const mockUseNodeConnections = jest.fn((): any[] => []);
const mockNodeLookup = new Map<string, any>();
const mockFFTCanvasProps = jest.fn();
const mockSendFrequencyRange = jest.fn((range: unknown) => ({
  type: "mock/sendFrequencyRange",
  payload: range,
}));

jest.mock("@xyflow/react", () => ({
  useNodes: () => mockUseNodes(),
  useNodeConnections: () => mockUseNodeConnections(),
  useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) =>
    selector({ nodeLookup: mockNodeLookup }),
}));
jest.mock("@n-apt/components/FFTCanvas", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: React.forwardRef((props: unknown, _ref: unknown) => {
      mockFFTCanvasProps(props);
      return React.createElement("div", { "data-testid": "fft-canvas" });
    }),
  };
});
jest.mock("@n-apt/redux/thunks/websocketThunks", () => ({
  sendFrequencyRange: (range: unknown) => mockSendFrequencyRange(range),
}));
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import {
  FFTNode,
  getFftNodeDisplayCenterHz,
  getFftNodeRoleRange,
  getFftNodeResolvedRange,
  getFftNodeSourceRange,
} from "@n-apt/components/react-flow/nodes/FFTNode";
import {
  isFilePlaybackPaused,
  shouldRestorePausedFrameSnapshot,
} from "@n-apt/hooks/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/utils/liveSourcePresentation";
import { TestWrapper } from "./testUtils";

describe("FFTNode", () => {
  const defaultProps = {
    id: "fft-node",
    data: {
      fftOptions: true,
      label: "FFT Transform",
    },
  };

  beforeEach(() => {
    mockUseNodes.mockReturnValue([]);
    mockNodeLookup.clear();
    mockUseNodeConnections.mockReturnValue([]);
    mockFFTCanvasProps.mockClear();
  });

  it("keeps the canvas center aligned with its edge-panned display range", () => {
    expect(
      getFftNodeDisplayCenterHz({
        displayRange: { min: 102, max: 112 },
        bandwidthCenterFreqHz: 105,
        fallbackCenterHz: 105,
      }),
    ).toBe(107);
  });

  it("keeps the requested range ahead of stale frame metadata", () => {
    expect(
      getFftNodeResolvedRange({
        requestedRange: { min: 110, max: 120 },
        frameRange: { min: 100, max: 110 },
      }),
    ).toEqual({ min: 110, max: 120 });
  });

  it("uses the Tx frame center and span instead of the Rx display range", () => {
    expect(
      getFftNodeRoleRange({
        sourceRole: "tx",
        fallbackRange: { min: 18_000, max: 4_390_000 },
        frame: {
          center_frequency_hz: 137_100_000,
          sample_rate: 2_400_000,
        },
      }),
    ).toEqual({ min: 135_900_000, max: 138_300_000 });
  });

  it("keeps a stale Tx frame on the configured viewer window until refresh", () => {
    expect(
      getFftNodeRoleRange({
        sourceRole: "tx",
        fallbackRange: { min: 127_975_000, max: 146_225_000 },
        expectedCenterFrequencyHz: 137_100_000,
        expectedSampleRateHz: 18_250_000,
        frame: {
          center_frequency_hz: 137_100_000,
          sample_rate: 2_400_000,
        },
      }),
    ).toEqual({ min: 127_975_000, max: 146_225_000 });
  });

  it("prefers file playback metadata over the stale live spectrum range", () => {
    expect(
      getFftNodeSourceRange({
        sourceMode: "file",
        liveRange: { min: 4_750_000, max: 23_000_000 },
        activePlaybackRange: { min: 620_265, max: 3_820_265 },
      }),
    ).toEqual({ min: 620_265, max: 3_820_265 });
  });

  it("keeps a remounted file canvas in paused-frame mode", () => {
    expect(
      isFilePlaybackPaused({ sourceMode: "file", isStitchPaused: true }),
    ).toBe(true);
    expect(
      isFilePlaybackPaused({ sourceMode: "file", isStitchPaused: false }),
    ).toBe(false);
    expect(
      isFilePlaybackPaused({ sourceMode: "live", isStitchPaused: true }),
    ).toBe(false);
  });

  it("changes the canvas session when leaving Mock APT for a new file", () => {
    const liveSession = getSourcePresentationSessionKey({
      sourceMode: "live",
      selectedFiles: [],
      stitchTrigger: 0,
    });
    const fileSession = getSourcePresentationSessionKey({
      sourceMode: "file",
      selectedFiles: [{ id: "capture-1", name: "capture.napt" }],
      stitchTrigger: 1,
    });

    expect(fileSession).not.toBe(liveSession);
  });

  it("does not restore a live paused snapshot into file playback", () => {
    expect(shouldRestorePausedFrameSnapshot({ sourceMode: "live" })).toBe(true);
    expect(shouldRestorePausedFrameSnapshot({ sourceMode: "file" })).toBe(
      false,
    );
  });

  it("scopes paused-frame snapshots to the active canvas session", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(mockFFTCanvasProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visualizerSessionKey: getSourcePresentationSessionKey({
          sourceMode: "live",
          selectedFiles: [],
          stitchTrigger: 0,
        }),
        pauseSnapshotEnabled: true,
      }),
    );
  });

  it("scopes a live canvas session to its selected source", () => {
    const firstSourceSession = getSourcePresentationSessionKey({
      sourceMode: "live",
      selectedFiles: [],
      stitchTrigger: 0,
      presentationRevision: "mock-apt",
    });
    const secondSourceSession = getSourcePresentationSessionKey({
      sourceMode: "live",
      selectedFiles: [],
      stitchTrigger: 0,
      presentationRevision: "mock-tx",
    });

    expect(firstSourceSession).not.toBe(secondSourceSession);
  });

  it("does not subscribe to the entire React Flow node collection", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(mockUseNodes).not.toHaveBeenCalled();
  });

  it("renders with label", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders FFT description", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders node title styling", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("FFT Transform")).toBeInTheDocument();
  });

  it("renders the FFT canvas", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getByTestId("fft-canvas")).toBeInTheDocument();
  });

  it("clears the node loading gate when the canvas presents its first frame", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    const firstProps = mockFFTCanvasProps.mock.calls[
      mockFFTCanvasProps.mock.calls.length - 1
    ]?.[0] as {
      awaitingDeviceData?: boolean;
      onRenderableFrameChange?: (ready: boolean) => void;
    };
    expect(firstProps.awaitingDeviceData).toBe(true);

    act(() => firstProps.onRenderableFrameChange?.(true));

    expect(
      mockFFTCanvasProps.mock.calls[mockFFTCanvasProps.mock.calls.length - 1]?.[0],
    ).toEqual(
      expect.objectContaining({ awaitingDeviceData: false }),
    );
  });

  it("renders its FFT canvas at the normal device backing resolution", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(mockFFTCanvasProps).toHaveBeenCalledWith(
      expect.objectContaining({ canvasResolutionScale: 1 }),
    );
  });

  it("renders with custom label", () => {
    const customProps = {
      id: "custom-fft",
      data: {
        fftOptions: true,
        label: "Custom FFT",
      },
    };

    render(
      <TestWrapper>
        <FFTNode {...customProps} />
      </TestWrapper>,
    );

    expect(screen.getByText("Custom FFT")).toBeInTheDocument();
  });

  it("applies 'nodrag' and 'nopan' classes to the canvas container", () => {
    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    const canvas = screen.getByTestId("fft-canvas");
    const container = canvas.closest(".nodrag.nopan") as HTMLElement;
    expect(container).toBeInTheDocument();

    const style = window.getComputedStyle(container);
    expect(style.pointerEvents).toBe("auto");
    expect(style.cursor).toBe("grab");
  });

  it("uses draggable-band edge panning when connected to a Span node", () => {
    mockNodeLookup.set("span-node", {
      id: "span-node",
      data: { spanOptions: true },
    });
    mockUseNodeConnections.mockReturnValue([{ source: "span-node" }]);

    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    expect(mockFFTCanvasProps).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionDisabled: false,
        selectionMode: "range",
        rangeSelectionInteraction: "edit-existing",
        selectionEdgePanMode: "frequency-range",
      }),
    );
  });

  it("publishes the new hardware range when edge panning", () => {
    mockNodeLookup.set("span-node", {
      id: "span-node",
      data: { spanOptions: true },
    });
    mockUseNodeConnections.mockReturnValue([{ source: "span-node" }]);

    render(
      <TestWrapper>
        <FFTNode {...defaultProps} />
      </TestWrapper>,
    );

    const props = mockFFTCanvasProps.mock.calls[
      mockFFTCanvasProps.mock.calls.length - 1
    ]?.[0] as {
      onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
    };
    const nextRange = { min: 110, max: 120 };
    act(() => props.onFrequencyRangeChange?.(nextRange));

    expect(mockSendFrequencyRange).toHaveBeenCalledWith(nextRange);
  });
});

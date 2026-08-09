import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTPlaybackCanvas from "@n-apt/spectrum/FFTPlaybackCanvas";

const dispatchMock = jest.fn();

jest.mock("@n-apt/spectrum", () => ({
  FFTAndWaterfall: React.forwardRef(() => null),
}));

jest.mock("@n-apt/redux", () => ({
  useAppDispatch: () => dispatchMock,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      waterfall: { stitchStatus: "Ready" },
      spectrum: { activeSignalArea: "A" },
      theme: { appMode: "system" },
    }),
  selectActiveSignalArea: jest.fn(() => "A"),
  bumpSnapshotSectionPulse: jest.fn(),
  setActivePlaybackMetadata: jest.fn(),
  setPlaybackChannels: jest.fn(),
  clearActivePlaybackMetadata: jest.fn(),
  setActiveSignalArea: jest.fn(),
  setSelectedFiles: jest.fn((files) => ({ type: "files/set", payload: files })),
  triggerStitch: jest.fn(() => ({ type: "stitch/trigger" })),
}));

jest.mock("@n-apt/capture/public/useSnapshot", () => ({
  useSnapshot: () => ({ handleSnapshot: jest.fn() }),
}));

jest.mock("@n-apt/capture/public/usePlaybackAnimation", () => ({
  usePlaybackAnimation: () => ({ animateFrame: jest.fn() }),
}));

jest.mock("@n-apt/spectrum/hooks/useChannelManagement", () => ({
  useChannelManagement: () => ({ switchChannel: jest.fn() }),
}));

jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  useSpectrumStore: () => ({ toggleVisualizerPause: jest.fn() }),
  useOptionalSpectrumStore: () => null,
}));

jest.mock("@n-apt/spectrum/hooks/useStitchingLogic", () => ({
  useStitchingLogic: ({
    onStitchStatus,
    stitchTrigger,
  }: {
    onStitchStatus?: (status: string) => void;
    stitchTrigger: number | null;
  }) => {
    React.useEffect(() => {
      onStitchStatus?.(stitchTrigger ? "Processing files" : "Ready");
    }, [onStitchStatus, stitchTrigger]);

    return {
      hasStitchedData: false,
      frequencyRange: { min: 0, max: 3_200_000 },
      channelCount: 0,
      activeChannel: 0,
      hardwareSampleRateHz: 3_200_000,
      allChannelsRef: { current: [] },
      workerFileDataCache: { current: [] },
      workerFreqMap: { current: [] },
      workerMetadataMap: { current: [] },
      precomputedFrames: { current: [] },
      maxFrames: { current: 0 },
      setChannelCount: jest.fn(),
      setActiveChannel: jest.fn(),
      setFrequencyRange: jest.fn(),
      setHardwareSampleRateHz: jest.fn(),
      stitchFiles: jest.fn(),
    };
  },
}));

const baseProps = {
  selectedFiles: [
    { id: "test1", name: "test1.napt" },
    { id: "test2", name: "test2.wav" },
  ],
  stitchTrigger: 0,
  stitchSourceSettings: { gain: 0, ppm: 0 },
  isPaused: false,
  fftSize: 2048,
  displayMode: "fft" as const,
};

describe("FFTPlaybackCanvas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the current empty state for selected files", () => {
    render(<FFTPlaybackCanvas {...baseProps} />);

    expect(screen.getByText("2 files selected")).toBeInTheDocument();
    expect(
      screen.getByText("Click Stitch/Process to visualize"),
    ).toBeInTheDocument();
  });

  it("prompts for files when the selection is empty", () => {
    render(<FFTPlaybackCanvas {...baseProps} selectedFiles={[]} />);

    expect(screen.getByText("No files selected")).toBeInTheDocument();
    expect(
      screen.getByText("Drop .napt, .iq, or .wav files here"),
    ).toBeInTheDocument();
  });

  it("reports processing when the parent triggers stitching", async () => {
    const onStitchStatus = jest.fn();

    render(
      <FFTPlaybackCanvas
        {...baseProps}
        stitchTrigger={1}
        onStitchStatus={onStitchStatus}
      />,
    );

    await waitFor(() => {
      expect(onStitchStatus).toHaveBeenCalledWith("Processing files");
    });
  });

  it("reports ready for the initial untriggered state", async () => {
    const onStitchStatus = jest.fn();

    render(<FFTPlaybackCanvas {...baseProps} onStitchStatus={onStitchStatus} />);

    await waitFor(() => {
      expect(onStitchStatus).toHaveBeenCalledWith("Ready");
    });
  });

  it("accepts supported dropped files and dispatches the file actions", () => {
    const container = render(<FFTPlaybackCanvas {...baseProps} />).container;
    const file = new File([new Uint8Array([1, 2])], "new.iq");

    fireEvent.drop(container.firstElementChild as Element, {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the component mountable across file selection changes", () => {
    const { rerender, unmount } = render(<FFTPlaybackCanvas {...baseProps} />);

    expect(() =>
      rerender(
        <FFTPlaybackCanvas
          {...baseProps}
          selectedFiles={[{ id: "new", name: "new.napt" }]}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText("1 file selected")).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });
});

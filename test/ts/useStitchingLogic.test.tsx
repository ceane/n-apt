import * as React from "react";
import { act, render } from "@testing-library/react";
import { useStitchingLogic } from "@n-apt/spectrum/hooks/useStitchingLogic";
import {
  clearStitchSession,
  createStitchSessionKey,
  setStitchSession,
  type StitchSessionData,
} from "@n-apt/spectrum/utils/stitchSessionCache";
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager";

const mockOfflinePlayback: any = {
  enabled: false,
  key: null,
  mode: null,
  captureSalt: null,
  markDecrypted: jest.fn(),
  setError: jest.fn(),
};

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({ aesKey: null }),
}));

jest.mock("@n-apt/app/hooks/OfflinePlaybackContext", () => ({
  useOfflinePlayback: () => mockOfflinePlayback,
}));

jest.mock("@n-apt/workers/fileWorkerManager", () => ({
  fileWorkerManager: { stitchFiles: jest.fn(() => new Promise(() => {})) },
}));

const props = {
  selectedFiles: [{ id: "cached", name: "cached.napt" }],
  stitchTrigger: 0,
  stitchSourceSettings: { gain: 0, ppm: 0 },
  fftSize: 2,
};
const sessionKey = createStitchSessionKey({
  ...props,
  settings: props.stitchSourceSettings,
});
const channels = [
  { label: "First", frequency_range: [100, 200] },
  { label: "Second", frequency_range: [200, 300] },
];
const cachedSession: StitchSessionData = {
  hasStitchedData: true,
  frequencyRange: { min: 200, max: 300 },
  channelCount: 2,
  activeChannel: 1,
  hardwareSampleRateHz: 100,
  workerFileDataCache: [["cached.napt", new Uint8Array([1, 2])]],
  workerFreqMap: [["cached.napt", 250]],
  workerMetadataMap: [["cached.napt", { channels_data: channels }]],
  precomputedFrames: [{ waveform: new Float32Array([-90, -40]) }],
  maxFrames: 1,
  allChannels: channels,
  stitchStatus: "Processed Successfully",
};

describe("useStitchingLogic cached restoration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setStitchSession(sessionKey, cachedSession);
  });

  afterEach(() => clearStitchSession(sessionKey));

  it("does not publish cached restoration from a suspended render", () => {
    const onChannelsChange = jest.fn();
    const onProcessedDataChange = jest.fn();
    const pending = new Promise(() => {});
    function SuspendedStitcher(): React.ReactNode {
      useStitchingLogic({ ...props, onChannelsChange, onProcessedDataChange });
      throw pending;
    }
    render(
      <React.Suspense fallback={<div>Loading</div>}>
        <SuspendedStitcher />
      </React.Suspense>,
    );
    expect(onChannelsChange).not.toHaveBeenCalled();
    expect(onProcessedDataChange).not.toHaveBeenCalled();
    expect(fileWorkerManager.stitchFiles).not.toHaveBeenCalled();
  });

  it("restores one consistent mount seed before paint without restarting cached work", () => {
    const onChannelsChange = jest.fn();
    const onProcessedDataChange = jest.fn();
    const painted = jest.fn();
    let latest: ReturnType<typeof useStitchingLogic>;
    function Stitcher() {
      latest = useStitchingLogic({ ...props, onChannelsChange, onProcessedDataChange });
      React.useLayoutEffect(() => {
        painted({
          activeChannel: latest.activeChannel,
          frequencyRange: latest.frequencyRange,
          channels: latest.allChannelsRef.current,
          frames: latest.precomputedFrames.current,
        });
      }, []);
      return null;
    }
    const { rerender } = render(<React.StrictMode><Stitcher /></React.StrictMode>);
    expect(painted).toHaveBeenCalledWith({
      activeChannel: 1,
      frequencyRange: cachedSession.frequencyRange,
      channels,
      frames: cachedSession.precomputedFrames,
    });
    expect(onChannelsChange).toHaveBeenCalledTimes(1);
    expect(onProcessedDataChange).toHaveBeenCalledTimes(1);
    expect(latest!.precomputedFrames.current).toBe(cachedSession.precomputedFrames);
    expect(fileWorkerManager.stitchFiles).not.toHaveBeenCalled();
    act(() => {
      latest!.setActiveChannel(0);
      latest!.setFrequencyRange({ min: 100, max: 200 });
    });
    rerender(<React.StrictMode><Stitcher /></React.StrictMode>);
    expect(latest!.activeChannel).toBe(0);
    expect(onChannelsChange).toHaveBeenCalledTimes(1);
  });
});

describe("useStitchingLogic automatic processing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockOfflinePlayback, {
      enabled: false,
      key: null,
      mode: null,
      captureSalt: null,
    });
  });

  it("coalesces file-selection and auto-process triggers for the same file", async () => {
    const emptyProps: typeof props = { ...props, selectedFiles: [], stitchTrigger: 0 };
    const nextProps = { ...props, stitchTrigger: 1 };

    function Stitcher({
      selectedFiles,
      stitchTrigger,
    }: typeof emptyProps) {
      useStitchingLogic({
        ...props,
        selectedFiles,
        stitchTrigger,
      });
      return null;
    }

    const { rerender } = render(<Stitcher {...emptyProps} />);
    await act(async () => {
      rerender(<Stitcher {...nextProps} />);
    });

    expect(fileWorkerManager.stitchFiles).toHaveBeenCalledTimes(1);
  });

  it("processes a guest capture once after unlock despite callback rerenders", async () => {
    const file = { id: "guest-capture", name: "guest.iq" };
    const stitchResult = {
      stitchedData: new Uint8Array([1]),
      fileDataCache: [],
      freqMap: [],
      metadataMap: [["guest.iq", { channels_data: [] }]],
      precomputedFrames: [],
      maxFrames: 0,
      channels: [],
      range: { min: 0, max: 1 },
    };
    (fileWorkerManager.stitchFiles as jest.Mock).mockResolvedValue(
      stitchResult,
    );
    mockOfflinePlayback.enabled = true;
    let shouldForceOneRender = true;

    function Stitcher() {
      const [, setRenderCount] = React.useState(0);
      useStitchingLogic({
        selectedFiles: [file],
        stitchTrigger: null,
        stitchSourceSettings: { gain: 0, ppm: 0 },
        fftSize: 2,
        onChannelsChange: () => {
          if (shouldForceOneRender) {
            shouldForceOneRender = false;
            setRenderCount((count) => count + 1);
          }
        },
        onProcessedDataChange: () => undefined,
      });
      return null;
    }

    const { rerender } = render(<Stitcher />);
    expect(fileWorkerManager.stitchFiles).not.toHaveBeenCalled();

    mockOfflinePlayback.key = {} as CryptoKey;
    mockOfflinePlayback.mode = "password";
    await act(async () => {
      rerender(<Stitcher />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      rerender(<Stitcher />);
    });

    expect(fileWorkerManager.stitchFiles).toHaveBeenCalledTimes(1);
  });
});

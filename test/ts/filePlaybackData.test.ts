import { filePlaybackDataRef } from "@n-apt/app/infrastructure/io/filePlaybackData";
import { getLiveFrameRefForSource } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  makeLiveFrame,
  resetLiveFrames,
  setLiveFrame,
} from "./liveFrameTestUtils";

describe("filePlaybackDataRef", () => {
  it("stores the processed first frame for file-mode consumers", () => {
    const frame = { waveform: new Float32Array([-90, -40, -70]) };

    filePlaybackDataRef.current = frame;

    expect(filePlaybackDataRef.current).toBe(frame);

    filePlaybackDataRef.current = null;
  });

  it("does not share the file seed with the live transport queue", () => {
    const liveFrame = makeLiveFrame(new Uint8Array([9, 9]), 1);
    const fileFrame = { iq_data: new Uint8Array([1, 2]) };
    setLiveFrame(liveFrame);
    filePlaybackDataRef.current = fileFrame;

    expect(getLiveFrameRefForSource("test-source", "rx").current).toBe(
      liveFrame,
    );
    expect(filePlaybackDataRef.current).toBe(fileFrame);

    resetLiveFrames();
    filePlaybackDataRef.current = null;
  });
});

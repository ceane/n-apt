import { filePlaybackDataRef } from "@n-apt/app/infrastructure/io/filePlaybackData";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";

describe("filePlaybackDataRef", () => {
  it("stores the processed first frame for file-mode consumers", () => {
    const frame = { waveform: new Float32Array([-90, -40, -70]) };

    filePlaybackDataRef.current = frame;

    expect(filePlaybackDataRef.current).toBe(frame);

    filePlaybackDataRef.current = null;
  });

  it("does not share the file seed with the live transport queue", () => {
    const liveFrame = { iq_data: new Uint8Array([9, 9]) };
    const fileFrame = { iq_data: new Uint8Array([1, 2]) };
    liveDataRef.current = liveFrame as any;
    filePlaybackDataRef.current = fileFrame;

    expect(liveDataRef.current).toBe(liveFrame);
    expect(filePlaybackDataRef.current).toBe(fileFrame);

    liveDataRef.current = null;
    filePlaybackDataRef.current = null;
  });
});

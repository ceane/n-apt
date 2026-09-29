import { readFileSync } from "node:fs";
import { encodeIqCaptureV4, type IqCaptureChunk } from "@n-apt/webusb/iqCaptureFormat";
import { getIqFrameAtOffset, getIqFrameTimestampAtOffset } from "@n-apt/capture/hooks/usePlaybackAnimation";

const captureFormat = require("@n-apt/webusb/iqCaptureFormat") as Record<string, unknown>;
const fixture = JSON.parse(readFileSync("test/fixtures/iq-capture-v6-playback.json", "utf8")) as {
  metadata: Record<string, unknown>;
  frames: Array<{
    sample_offset: number;
    timestamp_us: number;
    frame_sequence: number;
    fft_size: number;
    iq_data: number[];
  }>;
};

type Update = {
  sample_offset: number;
  timestamp_us: number;
  channel?: number;
  kind?: string;
  frame_sequence?: number;
  patch: Record<string, unknown>;
};

describe("cross-language V6 I/Q capture playback contract", () => {
  const crossLanguageTest = process.env.NAPT_IQ_CROSS_LANGUAGE_FIXTURE ? it : it.skip;

  crossLanguageTest("exports the backend writer output and plays it alongside the WebUSB writer output", async () => {
    const backendPath = process.env.NAPT_IQ_CROSS_LANGUAGE_FIXTURE;
    if (!backendPath) return;
    const webUsbUpdateBuilder = captureFormat.buildIqCaptureFrameUpdates as undefined | ((args: {
      sampleOffset: number;
      timestampUs: number;
      frameSequence: number;
      options: Record<string, unknown>;
      previousSignature: string | null;
    }) => { updates: Update[]; signature: string });
    expect(typeof webUsbUpdateBuilder).toBe("function");

    const options = {
      centerFrequencyHz: fixture.metadata.center_frequency_hz,
      sampleRateHz: fixture.metadata.capture_sample_rate_hz,
      fftSize: fixture.metadata.fft_size,
      fftWindow: fixture.metadata.fft_window,
      gainDb: fixture.metadata.gain,
      ppm: fixture.metadata.ppm,
    };
    let previousSignature: string | null = null;
    const webUsbUpdates: Update[] = [];
    const webUsbChunks: IqCaptureChunk[] = [];
    let sampleOffset = 0;
    const expectedIq = Uint8Array.from(fixture.frames.flatMap((frame) => frame.iq_data));
    for (const frame of fixture.frames) {
      expect(frame.sample_offset).toBe(sampleOffset * 2);
      const built = webUsbUpdateBuilder!({
        sampleOffset: frame.sample_offset,
        timestampUs: frame.timestamp_us,
        frameSequence: frame.frame_sequence,
        options: { ...options, fftSize: frame.fft_size },
        previousSignature,
      });
      webUsbUpdates.push(...built.updates);
      previousSignature = built.signature;
      const frameBytes = Uint8Array.from(frame.iq_data);
      webUsbChunks.push({ sample_offset: sampleOffset, channel: 0, data: frameBytes });
      sampleOffset += frameBytes.byteLength / 2;
    }

    const webUsbFile = await encodeIqCaptureV4({
      metadata: { ...fixture.metadata, duration_s: 0.0475, frame_rate: 63.1578947368 },
      frameUpdates: webUsbUpdates,
      chunks: webUsbChunks,
    });
    const backendFile = new Uint8Array(readFileSync(backendPath));

    const previousHandler = self.onmessage;
    const handler = (await import("@n-apt/workers/fileWorker"), self.onmessage) as unknown as (event: any) => Promise<void>;
    const postMessage = jest.spyOn(self, "postMessage").mockImplementation(() => {});
    const decode = async (fileData: Uint8Array, fileName: string) => {
      postMessage.mockClear();
      const owned = fileData.slice();
      await handler({ data: { type: "stitchFiles", id: "cross-language", data: {
        files: [{ fileData: owned.buffer, fileName }], settings: {}, fftSize: 2,
        allowIntegrityFailure: false,
      } } });
      const result = postMessage.mock.calls
        .map(([message]) => message as any)
        .find((message) => message.type === "result" || message.type === "error");
      expect(result?.type).toBe("result");
      return { metadata: result.data.metadataMap[0][1] as any, raw: result.data.fileDataCache[0][1] as Uint8Array };
    };

    try {
      const decoded = [
        await decode(backendFile, "backend.iq"),
        await decode(webUsbFile, "webusb.iq"),
      ];
      for (const { metadata, raw } of decoded) {
        expect(metadata.format_version).toBe(6);
        expect(raw).toEqual(expectedIq);
        const updates = metadata.frame_updates as Update[];
        const frameMarkers = updates.filter((update) => update.kind === "Frame");
        expect(frameMarkers.map(({ sample_offset }) => sample_offset)).toEqual([0, 4, 10]);
        expect(frameMarkers.map(({ timestamp_us }) => timestamp_us)).toEqual(
          fixture.frames.map((frame) => frame.timestamp_us),
        );
        expect(frameMarkers.map(({ frame_sequence }) => frame_sequence)).toEqual([0, 1, 2]);
        const optionsPatches = updates.filter((update) => update.kind === "PatchOptionsApplied");
        expect(optionsPatches.map(({ sample_offset }) => sample_offset)).toEqual([0, 4, 10]);
        expect(optionsPatches.map(({ frame_sequence }) => frame_sequence)).toEqual([0, 1, 2]);

        let byteOffset = 0;
        let currentFftSize = Number(fixture.metadata.fft_size);
        for (const [index, expectedFrame] of fixture.frames.entries()) {
          const playbackFrame = getIqFrameAtOffset(raw, byteOffset, currentFftSize, updates);
          expect(playbackFrame).not.toBeNull();
          expect(playbackFrame!.data).toEqual(Uint8Array.from(expectedFrame.iq_data));
          expect(playbackFrame!.fftSize).toBe(expectedFrame.fft_size);
          expect(playbackFrame!.nextOffset).toBe(expectedFrame.sample_offset + expectedFrame.iq_data.length);
          expect(getIqFrameTimestampAtOffset(updates, byteOffset)).toBe(expectedFrame.timestamp_us / 1000);
          byteOffset = playbackFrame!.nextOffset;
          currentFftSize = playbackFrame!.fftSize;
          expect(index).toBe(expectedFrame.frame_sequence);
        }
        expect(byteOffset).toBe(expectedIq.byteLength);
      }
    } finally {
      postMessage.mockRestore();
      self.onmessage = previousHandler;
    }
  });
});

import { readFileSync } from "node:fs";
import { encodeIqCaptureV4, type IqCaptureChunk } from "@n-apt/webusb/iqCaptureFormat";
import { getIqFrameAtOffset, getIqFrameTimestampAtOffset } from "@n-apt/capture/hooks/usePlaybackAnimation";
import { deriveRawKey } from "@n-apt/crypto/webcrypto";
import { parseNaptMetadata } from "@n-apt/capture/naptHeader";
import "@n-apt/workers/fileWorker";

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

  const fidoCrossLanguageTest =
    process.env.NAPT_FIDO_NAPT_CROSS_LANGUAGE_FIXTURE &&
    process.env.NAPT_FIDO_IQ_CROSS_LANGUAGE_FIXTURE
      ? it
      : it.skip;

  fidoCrossLanguageTest("plays both actual backend FIDO vault capture formats with the unlocked VMK", async () => {
    const fidoNaptPath = process.env.NAPT_FIDO_NAPT_CROSS_LANGUAGE_FIXTURE!;
    const fidoIqPath = process.env.NAPT_FIDO_IQ_CROSS_LANGUAGE_FIXTURE!;
    const fidoNapt = new Uint8Array(readFileSync(fidoNaptPath));
    const fidoIq = new Uint8Array(readFileSync(fidoIqPath));
    const vaultKey = await deriveRawKey("fido-vault-cross-language-key");
    const ordinaryLoginKey = await deriveRawKey("unrelated-login-vault-key");
    const fidoMetadata = parseNaptMetadata(fidoNapt);
    expect(fidoMetadata.encryption).toBe("AES-256-GCM-FIDO-VAULT-V1");
    expect(fidoMetadata.center_frequency_hz).toBe(137_500_000);

    const previousHandler = self.onmessage;
    const handler = (await import("@n-apt/workers/fileWorker"), self.onmessage) as unknown as (event: any) => Promise<void>;
    const postMessage = jest.spyOn(self, "postMessage").mockImplementation(() => {});
    const decode = async (fileData: Uint8Array, fileName: string) => {
      postMessage.mockClear();
      const owned = fileData.slice();
      await handler({ data: { type: "stitchFiles", id: "fido-cross-language", data: {
        files: [{ fileData: owned.buffer, fileName }],
        settings: {},
        fftSize: 2,
        aesKey: ordinaryLoginKey,
        fidoVaultKey: vaultKey,
      } } });
      const result = postMessage.mock.calls
        .map(([message]) => message as any)
        .find((message) => message.type === "result" || message.type === "error");
      expect(result?.type).toBe("result");
      return result.data;
    };

    try {
      const naptResult = await decode(fidoNapt, "backend-fido.napt");
      const expectedNaptIq = new Uint8Array(600 * 4).fill(128);
      expect(naptResult.fileDataCache[0][1]).toEqual(expectedNaptIq);
      const naptUpdates = naptResult.metadataMap[0][1].frame_updates;
      for (let frame = 0; frame < 3; frame += 1) {
        const sampleOffset = frame * 4;
        const playbackFrame = getIqFrameAtOffset(
          naptResult.fileDataCache[0][1],
          sampleOffset,
          2,
          naptUpdates,
        );
        expect(playbackFrame?.data).toEqual(expectedNaptIq.slice(sampleOffset, sampleOffset + 4));
        expect(getIqFrameTimestampAtOffset(naptUpdates, sampleOffset)).toBe(frame + 1);
      }

      const iqResult = await decode(fidoIq, "backend-fido.iq");
      const expectedIq = Uint8Array.of(128, 127, 129, 126, 130, 125, 131, 124, 132, 123, 133, 122);
      expect(iqResult.metadataMap[0][1].encryption).toBe("AES-256-GCM-FIDO-VAULT-V1");
      expect(iqResult.fileDataCache[0][1]).toEqual(expectedIq);
    } finally {
      postMessage.mockRestore();
      self.onmessage = previousHandler;
    }
  });

  const wavCrossLanguageTest = process.env.NAPT_WAV_CROSS_LANGUAGE_FIXTURE ? it : it.skip;
  wavCrossLanguageTest("loads and plays the actual backend WAV capture with plaintext I/Q metadata", async () => {
    const wavPath = process.env.NAPT_WAV_CROSS_LANGUAGE_FIXTURE!;
    const wav = new Uint8Array(readFileSync(wavPath));
    const expectedIq = Uint8Array.of(128, 127, 129, 126, 130, 125, 131, 124, 132, 123, 133, 122);
    const previousHandler = self.onmessage;
    const handler = self.onmessage as unknown as (event: any) => Promise<void>;
    const postMessage = jest.spyOn(self, "postMessage").mockImplementation(() => {});

    try {
      await handler({ data: { type: "stitchFiles", id: "wav-cross-language", data: {
        files: [{ fileData: wav.slice().buffer, fileName: "backend.wav" }],
        settings: {},
        fftSize: 2,
      } } });
      const result = postMessage.mock.calls
        .map(([message]) => message as any)
        .find((message) => message.type === "result" || message.type === "error");
      expect(result?.type).toBe("result");
      const metadata = result.data.metadataMap[0][1] as any;
      const raw = result.data.fileDataCache[0][1] as Uint8Array;
      expect(metadata.format).toBe("wav");
      expect(metadata.encrypted).toBe(false);
      expect(metadata.center_frequency_hz).toBe(137_500_000);
      expect(raw).toEqual(expectedIq);

      let byteOffset = 0;
      for (let frame = 0; frame < 3; frame += 1) {
        const playbackFrame = getIqFrameAtOffset(raw, byteOffset, 2, metadata.frame_updates);
        expect(playbackFrame?.data).toEqual(expectedIq.slice(byteOffset, byteOffset + 4));
        expect(getIqFrameTimestampAtOffset(metadata.frame_updates, byteOffset)).toBe(frame + 1);
        byteOffset = playbackFrame!.nextOffset;
      }
      expect(byteOffset).toBe(expectedIq.byteLength);
    } finally {
      postMessage.mockRestore();
      self.onmessage = previousHandler;
    }
  });
});

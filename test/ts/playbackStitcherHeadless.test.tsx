import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { encodeIqCaptureV4 } from "@n-apt/webusb/iqCaptureFormat";
import { deriveRawKey } from "@n-apt/crypto/webcrypto";
import { usePlaybackAnimation } from "@n-apt/capture/hooks/usePlaybackAnimation";
import {
  getIqFrameAtOffset,
  getIqFrameTimestampAtOffset,
} from "@n-apt/capture/hooks/usePlaybackAnimation";

const fixture = JSON.parse(
  readFileSync("test/fixtures/iq-capture-v6-playback.json", "utf8"),
) as {
  metadata: Record<string, unknown>;
  frames: Array<{
    sample_offset: number;
    timestamp_us: number;
    frame_sequence: number;
    fft_size: number;
    iq_data: number[];
  }>;
};
let fileWorkerHandler: ((event: MessageEvent) => Promise<void>) | null = null;

describe("headless capture stitcher playback", () => {
  it("advances every stitched I/Q frame and reports complete V6 frame metadata", async () => {
    const updates = fixture.frames.flatMap((frame) => [
      {
        sample_offset: frame.sample_offset,
        timestamp_us: frame.timestamp_us,
        kind: "Frame",
        frame_sequence: frame.frame_sequence,
        patch: {},
      },
      {
        sample_offset: frame.sample_offset,
        timestamp_us: frame.timestamp_us,
        kind: "PatchOptionsApplied",
        frame_sequence: frame.frame_sequence,
        patch: { fft_size: frame.fft_size },
      },
    ]);
    const fileBytes = await encodeIqCaptureV4({
      metadata: {
        ...fixture.metadata,
        format_version: 6,
        fft_size: fixture.frames[0].fft_size,
        frame_rate: 30,
      },
      frameUpdates: updates,
      chunks: fixture.frames.map((frame) => ({
        sample_offset: frame.sample_offset / 2,
        channel: 0,
        data: Uint8Array.from(frame.iq_data),
      })),
    });

    const previousHandler = self.onmessage;
    await import("@n-apt/workers/fileWorker");
    fileWorkerHandler = self.onmessage as unknown as (
      event: MessageEvent,
    ) => Promise<void>;
    const handler = fileWorkerHandler;
    const postMessage = jest
      .spyOn(self, "postMessage")
      .mockImplementation(() => {});
    try {
      await handler({
        data: {
          type: "stitchFiles",
          id: "headless-playback",
          data: {
            files: [
              {
                fileData: fileBytes.slice().buffer,
                fileName: "v6-playback.iq",
              },
            ],
            settings: {},
            fftSize: fixture.frames[0].fft_size,
          },
        },
      } as MessageEvent);

      const result = postMessage.mock.calls
        .map(([message]) => message as any)
        .find(
          (message) => message.type === "result" || message.type === "error",
        );
      expect(result?.type).toBe("result");

      const channels = result.data.metadataMap[0][1].channels_data;
      expect(channels).toHaveLength(1);
      const channel = channels[0];
      const frameUpdates = channel.frame_updates;
      const frameMarkers = frameUpdates.filter(
        (update: any) => update.kind === "Frame",
      );
      const missingMetadata = [
        ...(Number.isFinite(channel.center_freq_hz)
          ? []
          : ["center frequency"]),
        ...(Number.isFinite(channel.sample_rate_hz) ? [] : ["sample rate"]),
        ...(Number.isInteger(channel.bins_per_frame) &&
        channel.bins_per_frame > 0
          ? []
          : ["FFT size"]),
        ...(Number.isFinite(channel.frame_rate) && channel.frame_rate > 0
          ? []
          : ["frame rate"]),
        ...(frameMarkers.length === fixture.frames.length
          ? []
          : ["frame markers"]),
        ...(frameMarkers.every((update: any) =>
          Number.isFinite(update.timestamp_us),
        )
          ? []
          : ["timestamps"]),
        ...(frameMarkers.every(
          (update: any, index: number) => update.frame_sequence === index,
        )
          ? []
          : ["frame sequence"]),
        ...(frameMarkers.every(
          (update: any, index: number) =>
            update.sample_offset === fixture.frames[index].sample_offset,
        )
          ? []
          : ["sample offsets"]),
        ...(frameMarkers.every((frame: any, index: number) =>
          frameUpdates.some(
            (update: any) =>
              update.kind === "PatchOptionsApplied" &&
              update.sample_offset === frame.sample_offset &&
              update.patch?.fft_size === fixture.frames[index].fft_size,
          ),
        )
          ? []
          : ["per-frame FFT size patches"]),
      ];
      expect(missingMetadata).toEqual([]);

      const outputRef = { current: null as any };
      const emittedFrames: Array<{ data: Uint8Array; timestamp: number }> = [];
      const allChannelsRef = { current: channels };
      const playback = renderHook(() =>
        usePlaybackAnimation({
          hasStitchedData: true,
          isPaused: true,
          activeChannel: 0,
          fftSize: fixture.frames[0].fft_size,
          allChannelsRef,
          precomputedFrames: { current: [] },
          fftCanvasDataRef: outputRef,
          displayMode: "iq",
          onFrameEmitted: () => {
            if (outputRef.current)
              emittedFrames.push({
                data: outputRef.current.iq_data,
                timestamp: outputRef.current.timestamp,
              });
          },
        }),
      );

      act(() => {
        fixture.frames.forEach((_, index) =>
          playback.result.current.animateFrame(index * 40, true),
        );
      });

      expect(emittedFrames).toHaveLength(fixture.frames.length);
      expect(emittedFrames.map(({ data }) => Array.from(data))).toEqual(
        fixture.frames.map(({ iq_data }) => iq_data),
      );
      expect(emittedFrames.map(({ timestamp }) => timestamp)).toEqual(
        fixture.frames.map(({ timestamp_us }) => timestamp_us / 1000),
      );
      playback.unmount();
    } finally {
      postMessage.mockRestore();
      self.onmessage = previousHandler;
    }
  });

  const realCaptureRoot = process.env.NAPT_PLAYBACK_CAPTURE_ROOT;
  const corpusTest = realCaptureRoot ? it : it.skip;

  corpusTest(
    "stitches and advances up to three frames from each capture",
    async () => {
      const root = path.resolve(realCaptureRoot!);
      const capturePaths: string[] = [];
      const collect = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await collect(entryPath);
          else if (/\.(?:iq|napt|wav)$/i.test(entry.name))
            capturePaths.push(entryPath);
        }
      };
      await collect(root);
      capturePaths.sort();
      expect(capturePaths.length).toBeGreaterThan(0);
      const hasIqCaptures = capturePaths.some((capturePath) =>
        /\.(?:iq|napt)$/i.test(capturePath),
      );
      const passphrase =
        process.env.UNSAFE_LOCAL_USER_PASSWORD ??
        process.env.NAPT_LEGACY_CAPTURE_PASSWORD ??
        process.env.VITE_UNSAFE_LOCAL_USER_PASSWORD;
      if (hasIqCaptures && !passphrase) {
        throw new Error(
          "Set UNSAFE_LOCAL_USER_PASSWORD from .env.local before I/Q capture playback.",
        );
      }

      const previousHandler = self.onmessage;
      if (!fileWorkerHandler) {
        await import("@n-apt/workers/fileWorker");
        fileWorkerHandler = self.onmessage as unknown as (
          event: MessageEvent,
        ) => Promise<void>;
      }
      const handler = fileWorkerHandler;
      const aesKey = hasIqCaptures
        ? await deriveRawKey(passphrase!)
        : undefined;
      const postMessage = jest
        .spyOn(self, "postMessage")
        .mockImplementation(() => {});
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const failures: string[] = [];
      try {
        for (const capturePath of capturePaths) {
          const relativeName = path.relative(root, capturePath);
          postMessage.mockClear();
          try {
            const fileData = await readFile(capturePath);
            const fileName = path.basename(capturePath);
            const fileArrayBuffer = fileData.buffer.slice(
              fileData.byteOffset,
              fileData.byteOffset + fileData.byteLength,
            );
            if (path.extname(fileName).toLowerCase() === ".wav") {
              await handler({
                data: {
                  type: "stitchFiles",
                  id: "capture-corpus-wav-playback",
                  data: {
                    files: [{ fileData: fileArrayBuffer, fileName }],
                    settings: {},
                    fftSize: 2048,
                  },
                },
              } as MessageEvent);

              const wavResult = postMessage.mock.calls
                .map(([message]) => message as any)
                .find(
                  (message) =>
                    message.type === "result" || message.type === "error",
                );
              if (
                wavResult?.type !== "result" ||
                !(wavResult.data.fileDataCache[0]?.[1] instanceof Uint8Array) ||
                wavResult.data.fileDataCache[0][1].length < 2
              ) {
                failures.push(
                  `${relativeName}: WAV reader did not produce playable audio samples (${wavResult?.error ?? "empty audio data"})`,
                );
              }
              continue;
            }
            await handler({
              data: {
                type: "stitchFiles",
                id: "capture-corpus-playback",
                data: {
                  files: [
                    {
                      fileData: fileArrayBuffer,
                      fileName,
                    },
                  ],
                  settings: {},
                  fftSize: 2048,
                  aesKey,
                },
              },
            } as MessageEvent);

            const result = postMessage.mock.calls
              .map(([message]) => message as any)
              .find(
                (message) =>
                  message.type === "result" || message.type === "error",
              );
            if (result?.type !== "result") {
              failures.push(
                `${relativeName}: ${result?.error ?? "no stitch result"}`,
              );
              continue;
            }

            const metadata = result.data.metadataMap[0][1];
            const channels = metadata.channels_data ?? [];
            if (channels.length === 0) {
              failures.push(`${relativeName}: no playback channels`);
              continue;
            }

            for (const [channelIndex, channel] of channels.entries()) {
              const channelLabel = `${relativeName} channel ${channelIndex}`;
              const iq = channel.iq_data as Uint8Array;
              const initialFftSize = Number(
                channel.bins_per_frame ?? metadata.fft_size ?? 2048,
              );
              const updates = channel.frame_updates ?? [];
              if (!(iq instanceof Uint8Array) || iq.length < 2) {
                failures.push(`${channelLabel}: missing I/Q payload`);
                continue;
              }
              if (
                !Number.isFinite(channel.center_freq_hz) ||
                !Number.isFinite(channel.sample_rate_hz) ||
                !Number.isInteger(initialFftSize) ||
                initialFftSize <= 0 ||
                !Number.isFinite(channel.frame_rate) ||
                channel.frame_rate <= 0
              ) {
                failures.push(
                  `${channelLabel}: missing playback channel metadata`,
                );
                continue;
              }

              const expected: Array<{
                data: Uint8Array;
                timestamp: number | null;
                offset: number;
              }> = [];
              let byteOffset = 0;
              let fftSize = initialFftSize;
              while (expected.length < 3) {
                const frame = getIqFrameAtOffset(
                  iq,
                  byteOffset,
                  fftSize,
                  updates,
                );
                if (!frame) break;
                expected.push({
                  data: frame.data,
                  timestamp: getIqFrameTimestampAtOffset(updates, byteOffset),
                  offset: byteOffset,
                });
                byteOffset = frame.nextOffset;
                fftSize = frame.fftSize;
              }
              if (expected.length === 0) {
                failures.push(
                  `${channelLabel}: could not read the first I/Q frame`,
                );
                continue;
              }

              const frameMarkers = updates.filter(
                (update: any) => update.kind === "Frame",
              );
              if (
                Number(metadata.format_version) === 6 &&
                (frameMarkers.length === 0 ||
                  frameMarkers.some((update: any, index: number) => {
                    const previous = frameMarkers[index - 1];
                    return (
                      !Number.isFinite(update.timestamp_us) ||
                      update.frame_sequence !== index ||
                      !Number.isSafeInteger(update.sample_offset) ||
                      update.sample_offset < 0 ||
                      update.sample_offset >= iq.length ||
                      (previous &&
                        (update.sample_offset <= previous.sample_offset ||
                          update.timestamp_us <= previous.timestamp_us))
                    );
                  }) ||
                  expected.some(
                    (frame, index) =>
                      frameMarkers[index]?.sample_offset !== frame.offset ||
                      frame.timestamp === null,
                  ))
              ) {
                failures.push(`${channelLabel}: incomplete V6 frame metadata`);
                continue;
              }

              const outputRef = { current: null as any };
              const actual: Array<{ data: Uint8Array; timestamp: number }> = [];
              const playback = renderHook(() =>
                usePlaybackAnimation({
                  hasStitchedData: true,
                  isPaused: true,
                  activeChannel: channelIndex,
                  fftSize: initialFftSize,
                  allChannelsRef: { current: channels },
                  precomputedFrames: { current: [] },
                  fftCanvasDataRef: outputRef,
                  displayMode: "iq",
                  onFrameEmitted: () => {
                    if (outputRef.current) {
                      actual.push({
                        data: outputRef.current.iq_data,
                        timestamp: outputRef.current.timestamp,
                      });
                    }
                  },
                }),
              );
              act(() => {
                expected.forEach((_, index) =>
                  playback.result.current.animateFrame(index * 40, true),
                );
              });
              playback.unmount();

              if (
                actual.length !== expected.length ||
                actual.some(
                  (frame, index) =>
                    frame.data.length !== expected[index].data.length ||
                    frame.data.some(
                      (byte, byteIndex) =>
                        byte !== expected[index].data[byteIndex],
                    ) ||
                    (expected[index].timestamp !== null &&
                      frame.timestamp !== expected[index].timestamp),
                )
              ) {
                failures.push(
                  `${channelLabel}: playback did not advance through sampled frames`,
                );
              }
            }
          } catch (error) {
            failures.push(
              `${relativeName}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        expect(failures).toEqual([]);
      } finally {
        postMessage.mockRestore();
        consoleError.mockRestore();
        self.onmessage = previousHandler;
      }
    },
    180_000,
  );
});

import fc from "fast-check";
import {
  resolveDisplayRangeForPanOffset,
  resolvePanZoomForDisplayRange,
} from "@n-apt/math/basebandMirror";
import { getStableVizPanForZoomChange } from "@n-apt/spectrum/public/visualizationZoom";
import {
  shouldPresentSpectrumFrameForRange,
  shouldAdoptLiveFrameRange,
  newestIqWindow,
  resolveLiveSpectrumPaintContract,
  updateTemporalWaveform,
  type TemporalWaveformState,
} from "@n-apt/features/spectrum/fft/frameProcessing";

const ANY_FREQ = fc.oneof(
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.integer({ min: -3_000_000_000, max: 3_000_000_000 }),
  fc.integer({ min: 100_000_000, max: 2_000_000_000 }),
  fc.double({ min: 0.001, max: 2_000_000_000 }),
);

const ANY_RANGE = fc.record({
  min: ANY_FREQ,
  max: ANY_FREQ,
});

describe("frame processing fuzz", () => {
  it("range-presentation helpers never throw for any input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          ANY_FREQ,
          fc.constant(undefined as unknown as number),
          fc.constant(null as unknown as number),
        ),
        fc.oneof(
          ANY_FREQ,
          fc.constant(undefined as unknown as number),
          fc.constant(null as unknown as number),
        ),
        ANY_RANGE,
        fc.boolean(),
        fc.boolean(),
        (center, sampleRate, range, exact, tx) => {
          expect(() =>
            shouldPresentSpectrumFrameForRange({
              frameCenterHz: center,
              frameSampleRateHz: sampleRate,
              requestedRange: range,
              requiresExactRange: exact,
              isTxPreviewFrame: tx,
            }),
          ).not.toThrow();
          expect(() =>
            shouldAdoptLiveFrameRange({
              frameCenterHz: center,
              frameSampleRateHz: sampleRate,
              requestedRange: range,
              isTxPreviewFrame: tx,
            }),
          ).not.toThrow();
        },
      ),
    );
  });

  it("non-exact frames are always presentable", () => {
    fc.assert(
      fc.property(
        fc.oneof(ANY_FREQ, fc.constant(undefined as unknown as number)),
        fc.oneof(ANY_FREQ, fc.constant(undefined as unknown as number)),
        ANY_RANGE,
        (center, sampleRate, range) => {
          expect(
            shouldPresentSpectrumFrameForRange({
              frameCenterHz: center,
              frameSampleRateHz: sampleRate,
              requestedRange: range,
              requiresExactRange: false,
            }),
          ).toBe(true);
        },
      ),
    );
  });

  it("when requiresExactRange, frames with invalid sample rate or range are rejected", () => {
    fc.assert(
      fc.property(
        ANY_FREQ,
        fc.oneof(
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(0),
          fc.constant(-1),
        ),
        (center, badSampleRate) => {
          expect(
            shouldPresentSpectrumFrameForRange({
              frameCenterHz: center,
              frameSampleRateHz: badSampleRate,
              requestedRange: { min: 100_000_000, max: 101_000_000 },
              requiresExactRange: true,
            }),
          ).toBe(false);
        },
      ),
    );
  });

  describe("containment consistency", () => {
    it("presenting a valid frame requires the frame to cover the requested window within tolerance", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100_000_000, max: 1_500_000_000 }),
          fc.float({
            min: 1_000_000,
            max: 10_000_000,
            noDefaultInfinity: true,
          }),
          fc.integer({ min: 100_000_000, max: 1_500_000_000 }),
          fc.float({ min: 100_000, max: 5_000_000, noDefaultInfinity: true }),
          (center, sampleRate, reqCenter, reqSpan) => {
            const requestedRange = {
              min: reqCenter - reqSpan,
              max: reqCenter + reqSpan,
            };
            const present = shouldPresentSpectrumFrameForRange({
              frameCenterHz: center,
              frameSampleRateHz: sampleRate,
              requestedRange,
              requiresExactRange: true,
            });
            const frameMin = center - sampleRate / 2;
            const frameMax = center + sampleRate / 2;
            const tol = 1;
            const covers =
              reqCenter + reqSpan <= frameMax + tol &&
              reqCenter - reqSpan >= frameMin - tol;
            expect(present).toBe(covers);
          },
        ),
      );
    });
  });

  it("newestIqWindow always returns exactly fftSize*2 trailing bytes at an even index", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 255 }), {
          minLength: 0,
          maxLength: 4096,
        }),
        fc.integer({ min: -100, max: 8192 }),
        (bytes, fftSize) => {
          const iq = Uint8Array.from(bytes);
          let out: Uint8Array;
          expect(() => {
            out = newestIqWindow(iq, fftSize);
          }).not.toThrow();
          const result = out!;
          if (!Number.isFinite(fftSize) || fftSize <= 0) {
            expect(result).toBe(iq);
            return;
          }
          const bytesNeeded = Math.floor(fftSize) * 2;
          if (iq.length <= bytesNeeded) {
            expect(result).toBe(iq);
            return;
          }
          // Exactly one full window, starting on an even byte (I/Q aligned).
          expect(result.length).toBe(bytesNeeded);
          expect(result.byteOffset % 2).toBe(0);
          // The window lies entirely within the input buffer.
          expect(result.byteOffset + result.length).toBeLessThanOrEqual(
            iq.byteOffset + iq.length,
          );
        },
      ),
    );
  });

  it("updateTemporalWaveform never throws and returns a renderWaveform of matching length", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 260 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: -50, max: 512 }),
        (waveLen, temporalWindow, _seed) => {
          const waveform = new Float32Array(waveLen).map((_, i) => i * 0.5);
          const state: TemporalWaveformState = {
            framePool: [],
            activeFrames: [],
            writeIndex: 0,
            activeCount: 0,
            renderWaveform: null,
          };
          let out: {
            writeIndex: number;
            activeCount: number;
            renderWaveform: Float32Array;
          };
          expect(() => {
            out = updateTemporalWaveform(waveform, temporalWindow, state);
          }).not.toThrow();
          expect(out!.renderWaveform.length).toBe(waveLen);
          expect(out!.activeCount).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("scroll-lag paint contracts keep the resident frame axis and allow live presentation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 25_000_000_000 }),
        fc.integer({ min: 1_000_000, max: 8_000_000 }),
        fc.integer({ min: -3_000_000_000, max: 3_000_000_000 }),
        (centerHz, sampleRateHz, panOffsetHz) => {
          const sourceFrequencyRange = {
            min: centerHz - sampleRateHz / 2,
            max: centerHz + sampleRateHz / 2,
          };
          const requestedViewRange = {
            min: centerHz - sampleRateHz,
            max: centerHz + sampleRateHz,
          };

          const contract = resolveLiveSpectrumPaintContract({
            requestedViewRange,
            sourceFrequencyRange,
            zoom: 1,
            panOffsetHz,
            mirrorEnabled: true,
            frameCenterHz: centerHz,
            frameSampleRateHz: sampleRateHz,
          });

          expect(contract.paintViewportRange).toEqual(sourceFrequencyRange);
          expect(
            shouldPresentSpectrumFrameForRange({
              frameCenterHz: centerHz,
              frameSampleRateHz: sampleRateHz,
              requestedRange: requestedViewRange,
              requiresExactRange: false,
            }),
          ).toBe(true);
          expect(
            shouldAdoptLiveFrameRange({
              frameCenterHz: centerHz,
              frameSampleRateHz: sampleRateHz,
              requestedRange: requestedViewRange,
            }),
          ).toBe(false);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("paint contracts never produce NaN ranges and stay finite under fuzz", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -3_000_000_000, max: 3_000_000_000 }),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
        ),
        fc.oneof(
          fc.integer({ min: 1, max: 30_000_000_000 }),
          fc.constant(NaN),
          fc.constant(0),
          fc.constant(-1),
        ),
        fc.integer({ min: -3_000_000_000, max: 3_000_000_000 }),
        fc.float({ min: 1, max: 100, noDefaultInfinity: true }),
        fc.boolean(),
        (centerHz, sampleRateHz, panOffsetHz, zoom, mirrorEnabled) => {
          const sourceFrequencyRange = {
            min: centerHz - sampleRateHz / 2,
            max: centerHz + sampleRateHz / 2,
          };
          const requestedViewRange = {
            min: centerHz - sampleRateHz,
            max: centerHz + sampleRateHz,
          };

          let contract: {
            paintViewportRange: { min: number; max: number };
            sourceFrequencyRange: { min: number; max: number };
            displayRange: { min: number; max: number };
            zoom: number;
            panOffsetHz: number;
          };
          expect(() => {
            contract = resolveLiveSpectrumPaintContract({
              requestedViewRange,
              sourceFrequencyRange,
              zoom,
              panOffsetHz,
              mirrorEnabled,
            });
          }).not.toThrow();

          for (const range of [
            contract!.paintViewportRange,
            contract!.sourceFrequencyRange,
            contract!.displayRange,
          ]) {
            expect(
              Number.isFinite(range.min) && Number.isFinite(range.max),
            ).toBe(true);
            expect(range.max >= range.min).toBe(true);
          }
          expect(Number.isFinite(contract!.zoom)).toBe(true);
          expect(Number.isFinite(contract!.panOffsetHz)).toBe(true);
        },
      ),
      { numRuns: 120 },
    );
  });

  it("never stretches a retained frame onto a wider DC-anchored request", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 30_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (requestedSpanHz, guardRatio) => {
          const guardHz = Math.max(
            1,
            Math.floor((requestedSpanHz * guardRatio) / 1_000),
          );
          const requestedViewRange = { min: 0, max: requestedSpanHz };
          const retainedFrameRange = {
            min: guardHz,
            max: requestedSpanHz - guardHz,
          };

          const contract = resolveLiveSpectrumPaintContract({
            requestedViewRange,
            sourceFrequencyRange: retainedFrameRange,
            zoom: 1,
            panOffsetHz: 0,
            mirrorEnabled: true,
          });

          expect(contract.displayRange).toEqual(retainedFrameRange);
          expect(contract.paintViewportRange).toEqual(retainedFrameRange);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("keeps every live retained-frame paint within its acquisition window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 30_000_000 }),
        fc.integer({ min: 1_000_000, max: 30_000_000 }),
        fc.integer({ min: -20_000_000, max: 20_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.boolean(),
        (requestedSpanHz, sourceSpanHz, panOffsetHz, zoom, mirrorEnabled) => {
          const requestedViewRange = { min: 0, max: requestedSpanHz };
          const sourceFrequencyRange = {
            min: 40_000_000,
            max: 40_000_000 + sourceSpanHz,
          };
          const contract = resolveLiveSpectrumPaintContract({
            requestedViewRange,
            sourceFrequencyRange,
            zoom,
            panOffsetHz,
            mirrorEnabled,
          });
          const displaySpan =
            contract.displayRange.max - contract.displayRange.min;
          const sourceSpan =
            sourceFrequencyRange.max - sourceFrequencyRange.min;

          expect(displaySpan).toBeLessThanOrEqual(sourceSpan + 1);
          expect(contract.paintViewportRange).toEqual(sourceFrequencyRange);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("round-trips zoom-in then zoom-out across DC without clamping the signed view", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 30_000_000 }),
        fc.integer({ min: 2, max: 1_125 }),
        fc.integer({ min: -1_000, max: 0 }),
        (sampleRateHz, zoomIn, panRatio) => {
          const acquisition = { min: 0, max: sampleRateHz };
          const zoomInPan = Math.round((sampleRateHz * panRatio) / 1_000);
          const zoomOutPan = getStableVizPanForZoomChange({
            currentZoom: zoomIn,
            currentPan: zoomInPan,
            nextZoom: 1,
            rangeMin: acquisition.min,
            rangeMax: acquisition.max,
            allowNegativeFrequencies: true,
          });
          const expectedDisplayRange = resolveDisplayRangeForPanOffset({
            hardwareRange: acquisition,
            zoom: 1,
            panOffsetHz: zoomOutPan,
          });
          const contract = resolveLiveSpectrumPaintContract({
            requestedViewRange: acquisition,
            sourceFrequencyRange: acquisition,
            zoom: 1,
            panOffsetHz: zoomOutPan,
            mirrorEnabled: true,
          });

          expect(contract.displayRange).toEqual(expectedDisplayRange);
          expect(
            resolvePanZoomForDisplayRange({
              hardwareRange: acquisition,
              displayRange: contract.displayRange,
            }),
          ).toEqual({ zoom: 1, panOffsetHz: zoomOutPan });
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

import fc from "fast-check";
import { resolveChannelFocusRange } from "@n-apt/spectrum/hooks/useLiveSampleRateControl";

describe("resolveChannelFocusRange", () => {
  const channelBounds = { min: 4_750_000, max: 23_000_000 };

  it("centers a selected sample-rate window on the channel", () => {
    expect(
      resolveChannelFocusRange({
        channelBounds,
        sampleRateHz: 5_000_000,
        wholeChannel: false,
      }),
    ).toEqual({ min: 11_375_000, max: 16_375_000 });
  });

  it("uses the complete channel bounds for Whole Channel", () => {
    expect(
      resolveChannelFocusRange({
        channelBounds,
        sampleRateHz: 5_000_000,
        wholeChannel: true,
      }),
    ).toEqual(channelBounds);
  });

  it("keeps a wider selected sample-rate window centered as intentional overscan", () => {
    expect(
      resolveChannelFocusRange({
        channelBounds: { min: 18_000, max: 4_390_000 },
        sampleRateHz: 5_000_000,
        wholeChannel: false,
      }),
    ).toEqual({ min: 0, max: 5_000_000 });
  });

  it("keeps fuzzed channel clicks independent from stale centers", () => {
    const channelBoundsArbitrary = fc
      .record({
        min: fc.integer({ min: 1_000_000, max: 200_000_000 }),
        span: fc.integer({ min: 100_000, max: 30_000_000 }),
      })
      .map(({ min, span }) => ({ min, max: min + span }));
    const rateArbitrary = fc.integer({ min: 100_000, max: 40_000_000 });

    fc.assert(
      fc.property(
        channelBoundsArbitrary,
        fc.array(
          fc.record({
            sampleRateHz: rateArbitrary,
            wholeChannel: fc.boolean(),
            staleCenterHz: fc.integer({ min: 250_000_000, max: 300_000_000 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (bounds, clicks) => {
          const channelCenter = (bounds.min + bounds.max) / 2;

          for (const click of clicks) {
            const focused = resolveChannelFocusRange({
              channelBounds: bounds,
              sampleRateHz: click.sampleRateHz,
              wholeChannel: click.wholeChannel,
            });

            expect(Number.isFinite(focused.min)).toBe(true);
            expect(Number.isFinite(focused.max)).toBe(true);
            expect(focused.min).toBeGreaterThanOrEqual(0);
            expect(focused.max).toBeGreaterThan(focused.min);
            const focusedCenter = (focused.min + focused.max) / 2;
            expect(Math.abs(focusedCenter - click.staleCenterHz)).toBeGreaterThan(
              1,
            );

            if (click.wholeChannel) {
              expect(focused).toEqual(bounds);
              expect(focused.max - focused.min).toBe(bounds.max - bounds.min);
            } else {
              expect(focused.max - focused.min).toBe(click.sampleRateHz);
              expect(focused.min).toBeLessThanOrEqual(channelCenter);
              expect(focused.max).toBeGreaterThanOrEqual(channelCenter);
              if (click.sampleRateHz < bounds.max - bounds.min) {
                expect(focused.min).toBeGreaterThanOrEqual(bounds.min);
                expect(focused.max).toBeLessThanOrEqual(bounds.max);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

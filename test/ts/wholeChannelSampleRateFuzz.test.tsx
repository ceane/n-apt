/** @jest-environment jsdom */
import fc from "fast-check";
import React from "react";
import {
  act,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import {
  buildLiveSampleRateRange,
  canUseWholeChannelSampleRate,
  getWholeChannelSampleRate,
  resolveChannelFocusRange,
  resolveHackrfBasebandSampleRateHz,
  useLiveSampleRateControl,
} from "@n-apt/spectrum/hooks/useLiveSampleRateControl";
import {
  assertValidSampleRateHz,
  isValidSampleRateHz,
  resolveCanonicalDisplaySampleRateHz,
  resolveSourceSampleRateHz,
} from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";
import { resolveWholeChannelViewport } from "@n-apt/spectrum/utils/wholeChannelPresentation";
import { resolveWholeChannelMode } from "@n-apt/spectrum/utils/wholeChannelControl";
import { resolveSourceDisplaySampleRate } from "@n-apt/app/infrastructure/visualization/sourceSignalDisplay";
import { SignalDisplaySection } from "@n-apt/spectrum/sidebar/SignalDisplaySection";
import { TestWrapper } from "./testUtils";

/**
 * Whole Channel sample-rate fuzzing.
 *
 * The reported failure mode is "Whole Channel is selected but the source stays
 * pinned at the 3.2 MHz receive floor". Staleness here is a *state* problem,
 * not a single-branch problem: a mode flag, a pending rate, a channel span and
 * a backend echo can disagree after an arbitrary interleaving of gestures,
 * channel switches and telemetry updates. Reading the branches by hand is
 * exactly what keeps missing it, so these tests assert the invariants over
 * randomized event sequences and let fast-check shrink a counterexample.
 *
 * Invariants under test (each is independently meaningful, not a restatement
 * of the implementation):
 *
 *  INV-1  Every applied acquisition rate is a finite positive number.
 *  INV-2  A published acquisition window always has a span equal to the rate
 *         it was published with (rate and view can never drift apart).
 *  INV-3  While Whole Channel is the *claimed* mode, the effective acquisition
 *         rate equals the Whole Channel rate the claim is derived from. This
 *         is the "shows Whole Channel, runs at 3.2 MHz" bug class.
 *  INV-4  After an explicit manual selection, the effective rate stays that
 *         selection until another explicit selection (no stale resurrection).
 */

const RECEIVE_FLOOR_HZ = 3_200_000;
const HACKRF_CEILING_HZ = 20_000_000;
/** Mirrors SAMPLE_RATE_TOLERANCE_HZ in sdrSampleRateGuards. */
const RATE_TOLERANCE_HZ = 10_000;

/** Canonical N-APT channel spans, the domain where Whole Channel matters. */
const CHANNELS = [
  { label: "A", min: 18_000, span: 4_372_000 },
  { label: "B", min: 24_100_000, span: 6_270_000 },
  { label: "C", min: 4_750_000, span: 18_250_000 },
] as const;

const rateArb = fc.integer({ min: 100_000, max: HACKRF_CEILING_HZ });
const rateOrJunkArb = fc.oneof(
  { weight: 7, arbitrary: rateArb },
  {
    weight: 1,
    arbitrary: fc.constantFrom(0, -1, Number.NaN, Number.POSITIVE_INFINITY),
  },
  { weight: 1, arbitrary: fc.constantFrom(100, 1_000, 4_372_000, 18_250_000) },
);
const channelArb = fc.constantFrom(...CHANNELS);

describe("sample-rate producer validation fuzz", () => {
  it("throws for every invalid rate and passes every valid one through", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(
            0,
            -1,
            -5_200_000,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
          ),
          fc.double({ noNaN: false, min: -1e9, max: 0 }),
        ),
        (invalid) => {
          fc.pre(!isValidSampleRateHz(invalid));
          expect(() => assertValidSampleRateHz(invalid, "fuzz")).toThrow(
            /Invalid sample rate from fuzz/,
          );
        },
      ),
      { numRuns: 300 },
    );

    fc.assert(
      fc.property(rateArb, (valid) => {
        expect(assertValidSampleRateHz(valid, "fuzz")).toBe(valid);
      }),
      { numRuns: 300 },
    );
  });

  it("fails at the producer when the rate control is handed a junk rate", () => {
    const initialProps = {
      sourceMode: "live" as const,
      supportsWholeChannelSampleRate: true,
      activeChannelSampleRate: CHANNELS[0].span,
      activeSignalAreaBounds: {
        min: CHANNELS[0].min,
        max: CHANNELS[0].min + CHANNELS[0].span,
      },
      frequencyRange: { min: 18_000, max: 18_000 + CHANNELS[0].span },
      sampleRateHz: RECEIVE_FLOOR_HZ,
      maxSampleRateHz: HACKRF_CEILING_HZ,
      setSampleRate: jest.fn(),
      setSampleRateWithFrequencyRange: jest.fn(),
      applyFrequencyRange: jest.fn(),
    };

    const { result } = renderHook(
      (props: typeof initialProps) => useLiveSampleRateControl(props),
      { initialProps },
    );

    for (const invalid of [
      Number.NaN,
      0,
      -3_200_000,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        act(() => {
          result.current.handleSampleRateChange(invalid, "manual");
        }),
      ).toThrow(/Invalid sample rate/);
    }

    // The junk never reached the device write.
    expect(initialProps.setSampleRate).not.toHaveBeenCalled();
    expect(initialProps.setSampleRateWithFrequencyRange).not.toHaveBeenCalled();
  });
});

describe("Whole Channel sample-rate derivation fuzz", () => {
  it("INV-2: a valid rate always yields a window of exactly that width", () => {
    fc.assert(
      fc.property(
        rateArb,
        fc.option(channelArb, { nil: null }),
        fc.integer({ min: 0, max: 200_000_000 }),
        fc.integer({ min: 0, max: 40_000_000 }),
        fc.constantFrom<"start" | "center" | "end">("start", "center", "end"),
        (sampleRateHz, channel, min, currentSpan, anchor) => {
          const range = buildLiveSampleRateRange({
            currentRange: { min, max: min + currentSpan },
            sampleRateHz,
            channelBounds: channel
              ? { min: channel.min, max: channel.min + channel.span }
              : null,
            startingAnchorPosition: anchor,
          });

          expect(Number.isFinite(range.min)).toBe(true);
          expect(Number.isFinite(range.max)).toBe(true);

          const span = Math.round(range.max - range.min);
          // The window may be clamped inside channel bounds, never widened.
          expect(span).toBeLessThanOrEqual(sampleRateHz);

          // Without channel bounds the window is exactly the requested rate:
          // this is what makes "change the rate" change the display. When
          // channel bounds are present and the rate is narrower than the
          // channel, the window still spans the full rate unless the channel
          // itself is narrower than the rate.
          if (!channel || sampleRateHz <= channel.span) {
            expect(span).toBe(sampleRateHz);
          }
        },
      ),
      { numRuns: 800 },
    );
  });

  it("INV-2: a stale/invalid rate can never collapse the window to zero width", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, -1, Number.NaN, Number.POSITIVE_INFINITY),
        fc.option(channelArb, { nil: null }),
        fc.integer({ min: 0, max: 200_000_000 }),
        fc.integer({ min: 0, max: 40_000_000 }),
        (sampleRateHz, channel, min, currentSpan) => {
          const range = buildLiveSampleRateRange({
            currentRange: { min, max: min + currentSpan },
            sampleRateHz,
            channelBounds: channel
              ? { min: channel.min, max: channel.min + channel.span }
              : null,
          });

          // A broken reference must not blank the view.
          expect(Number.isFinite(range.min)).toBe(true);
          expect(Number.isFinite(range.max)).toBe(true);
          expect(Math.round(range.max - range.min)).toBeGreaterThan(0);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("INV-3 (derivation): a HackRF Whole Channel target is the channel span, never a generic floor", () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.integer({ min: 0, max: 60_000_000 }),
        fc.constantFrom(true, false),
        (channel, reportedMax, isHackrf) => {
          const supportsWholeChannel = true;
          const channelBounds = {
            min: channel.min,
            max: channel.min + channel.span,
          };

          // Mirrors SpectrumSidebar's derivation of the Whole Channel viewport:
          // whole-channel capable sources get the HackRF ceiling, everything
          // else is bounded by the reported source maximum.
          const viewport = resolveWholeChannelViewport({
            channelBounds,
            maxSampleRateHz: isHackrf
              ? Math.max(reportedMax, HACKRF_CEILING_HZ)
              : reportedMax,
          });
          const wholeChannelRate = viewport.max - viewport.min;

          // The window never escapes the channel.
          expect(viewport.min).toBeGreaterThanOrEqual(channelBounds.min);
          expect(viewport.max).toBeLessThanOrEqual(channelBounds.max);

          if (isHackrf && channel.span <= HACKRF_CEILING_HZ) {
            // A HackRF can always reach the whole channel, so the offered
            // value must be the channel width and not a smaller floor.
            expect(wholeChannelRate).toBe(channel.span);
          }
          expect(wholeChannelRate).toBeGreaterThan(0);

          const effectiveMax = isHackrf
            ? Math.max(reportedMax, HACKRF_CEILING_HZ)
            : reportedMax;
          // A missing/zero maximum cannot gate the option; a real ceiling must:
          // the offered width is only usable when the source can reach it. The
          // viewport is already clamped to the ceiling, so this is exactly the
          // "Whole Channel must never be offered above the source maximum" law.
          expect(
            canUseWholeChannelSampleRate({
              supportsWholeChannelSampleRate: supportsWholeChannel,
              activeChannelSampleRate: wholeChannelRate,
              maxSampleRateHz: effectiveMax,
            }),
          ).toBe(effectiveMax <= 0 || wholeChannelRate <= effectiveMax);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("INV-3 (mode): Whole Channel mode requires the rate to equal the channel span", () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.option(rateArb, { nil: null }),
        (channel, sampleRateHz) => {
          const span = channel.span;
          const isWholeChannel = resolveWholeChannelMode({
            supportsWholeChannel: true,
            sampleRateHz,
            activeChannelBounds: { min: 0, max: span },
          });
          if (isWholeChannel) {
            expect(Math.round(sampleRateHz as number)).toBe(Math.round(span));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("INV-1: display-rate resolution never surfaces a stale candidate", () => {
    fc.assert(
      fc.property(
        rateOrJunkArb,
        fc.option(rateArb, { nil: null }),
        fc.option(rateArb, { nil: null }),
        fc.option(fc.integer({ min: 1, max: 60_000_000 }), { nil: null }),
        (
          activeSampleRateHz,
          frameSampleRateHz,
          configuredSampleRateHz,
          maxSampleRateHz,
        ) => {
          const resolved = resolveCanonicalDisplaySampleRateHz({
            activeSampleRateHz,
            frameSampleRateHz,
            configuredSampleRateHz,
            derivedSampleRateHz: null,
            maxSampleRateHz,
            deviceKind: "hackrf_one",
            backend: "hackrf",
            deviceName: "HackRF One",
            isRtlSdr: false,
          });

          expect(
            resolved === null || (resolved > 0 && Number.isFinite(resolved)),
          ).toBe(true);
          if (resolved !== null && maxSampleRateHz !== null) {
            expect(resolved).toBeLessThanOrEqual(maxSampleRateHz);
          }

          // The explicit live selection is the render authority whenever it is
          // reachable: a stale frame/config value must not win over it.
          const active = getWholeChannelSampleRate(activeSampleRateHz);
          if (
            active !== null &&
            (maxSampleRateHz === null || active <= maxSampleRateHz)
          ) {
            expect(resolved).toBe(active);
          }
        },
      ),
      { numRuns: 800 },
    );
  });

  it("INV-1: source rate resolution honours the maximum and never returns junk", () => {
    fc.assert(
      fc.property(
        fc.array(rateOrJunkArb, { maxLength: 4 }),
        fc.option(fc.integer({ min: 1, max: 60_000_000 }), { nil: null }),
        (candidates, maxSampleRateHz) => {
          const resolved = resolveSourceSampleRateHz({
            candidates,
            maxSampleRateHz,
          });

          if (resolved !== null) {
            expect(resolved).toBeGreaterThan(0);
            expect(Number.isFinite(resolved)).toBe(true);
            if (maxSampleRateHz !== null) {
              expect(resolved).toBeLessThanOrEqual(maxSampleRateHz);
            }
          }

          const firstValid = candidates.find(
            (candidate) =>
              typeof candidate === "number" &&
              Number.isFinite(candidate) &&
              candidate > 0 &&
              (maxSampleRateHz === null || candidate <= maxSampleRateHz),
          );
          if (firstValid !== undefined && firstValid !== null) {
            expect(resolved).toBe(firstValid);
          } else if (maxSampleRateHz !== null) {
            expect(resolved).toBe(maxSampleRateHz);
          }
        },
      ),
      { numRuns: 800 },
    );
  });

  it("INV-1: the HackRF baseband rate follows the whole-channel claim, not a stale local rate", () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.option(rateArb, { nil: null }),
        fc.boolean(),
        (channel, sampleRateHz, isWholeChannelMode) => {
          const resolved = resolveHackrfBasebandSampleRateHz({
            isHackrfOne: true,
            sourceMode: "live",
            isWholeChannelMode,
            wholeChannelSampleRate: channel.span,
            sampleRateHz,
          });

          if (isWholeChannelMode) {
            // A whole-channel claim must drive the hardware to the channel
            // width even while a stale local rate is still in state.
            expect(resolved).toBe(channel.span);
          } else {
            expect(resolved).toBe(sampleRateHz);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("INV-3: channel focus derives its window from the channel, whole or windowed", () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.option(rateArb, { nil: null }),
        fc.boolean(),
        (channel, sampleRateHz, wholeChannel) => {
          const channelBounds = {
            min: channel.min,
            max: channel.min + channel.span,
          };
          const range = resolveChannelFocusRange({
            channelBounds,
            sampleRateHz,
            wholeChannel,
          });

          expect(range.max).toBeGreaterThan(range.min);

          if (wholeChannel) {
            // Whole Channel is exactly the channel bounds.
            expect(Math.round(range.max - range.min)).toBe(channel.span);
            expect(range.min).toBeGreaterThanOrEqual(channelBounds.min);
            expect(range.max).toBeLessThanOrEqual(channelBounds.max);
            return;
          }

          const requested = Math.max(
            1,
            Math.round(sampleRateHz ?? channel.span),
          );
          const span = Math.round(range.max - range.min);
          if (requested >= channel.span) {
            expect(span).toBe(requested);
          } else {
            expect(span).toBeLessThanOrEqual(requested);
            expect(range.min).toBeGreaterThanOrEqual(channelBounds.min);
            expect(range.max).toBeLessThanOrEqual(channelBounds.max);
          }
        },
      ),
      { numRuns: 600 },
    );
  });

  it("INV-4: display-rate resolution prefers the active role's local selection", () => {
    fc.assert(
      fc.property(
        rateOrJunkArb,
        fc.option(rateArb, { nil: null }),
        fc.option(rateArb, { nil: null }),
        fc.boolean(),
        (
          localSampleRateHz,
          liveSampleRateHz,
          sourceSampleRateHz,
          isActiveRole,
        ) => {
          const resolved = resolveSourceDisplaySampleRate({
            roleSourceId: "hackrf-1",
            activeSourceId: "hackrf-1",
            localSampleRateHz: isActiveRole ? localSampleRateHz : null,
            liveSampleRateHz,
            sourceSampleRateHz,
            fallbackSampleRateHz: RECEIVE_FLOOR_HZ,
          });

          if (resolved === null) return;
          expect(resolved).toBeGreaterThan(0);

          const local = getWholeChannelSampleRate(localSampleRateHz);
          if (isActiveRole && local !== null) {
            expect(resolved).toBe(local);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

type HookProps = Parameters<typeof useLiveSampleRateControl>[0];

type RateEvent =
  | { kind: "selectManual"; rate: number }
  | { kind: "selectWhole" }
  | { kind: "echoRate"; rate: number }
  | { kind: "switchChannel"; min: number; span: number }
  | { kind: "pan"; min: number; span: number };

const rateEventArb: fc.Arbitrary<RateEvent> = fc.oneof(
  rateArb.map((rate) => ({ kind: "selectManual" as const, rate })),
  fc.constant({ kind: "selectWhole" as const }),
  rateArb.map((rate) => ({ kind: "echoRate" as const, rate })),
  channelArb.map((channel) => ({
    kind: "switchChannel" as const,
    min: channel.min,
    span: channel.span,
  })),
  fc
    .tuple(
      fc.integer({ min: 0, max: 30_000_000 }),
      fc.integer({ min: 1, max: 30_000_000 }),
    )
    .map(([min, span]) => ({ kind: "pan" as const, min, span })),
);

describe("useLiveSampleRateControl state-machine fuzz", () => {
  it("INV-1..INV-4: channel switches, rate echoes and gestures never desync the claim from the rate", () => {
    fc.assert(
      fc.property(
        fc.array(rateEventArb, { minLength: 1, maxLength: 24 }),
        (events) => {
          const trace: string[] = [];
          const appliedRates: number[] = [];
          const appliedWindows: Array<{ rate: number; span: number }> = [];
          const viewWindows: Array<{
            span: number;
            deviceRate: number | null;
            step: string;
          }> = [];
          // The rate the device is believed to be running at. A request we sent
          // that has not been acknowledged yet is the belief; a source snapshot
          // that merely disagrees with it is stale and must not move the belief
          // (that is the documented staleness policy), while a snapshot arriving
          // with no request outstanding is authoritative.
          const deviceRateRef: { current: number | null } = {
            current: RECEIVE_FLOOR_HZ,
          };
          const pendingRequestRef: { current: number | null } = {
            current: null,
          };
          const setSampleRate = jest.fn((rate: number) => {
            appliedRates.push(rate);
            pendingRequestRef.current = rate;
            deviceRateRef.current = rate;
          });
          const setSampleRateWithFrequencyRange = jest.fn(
            (rate: number, range: { min: number; max: number }) => {
              appliedRates.push(rate);
              pendingRequestRef.current = rate;
              deviceRateRef.current = rate;
              appliedWindows.push({
                rate,
                span: Math.round(range.max - range.min),
              });
            },
          );
          const applyFrequencyRange = jest.fn(
            (range: { min: number; max: number }) => {
              viewWindows.push({
                span: Math.round(range.max - range.min),
                deviceRate: deviceRateRef.current,
                step: trace[trace.length - 1] ?? "mount",
              });
            },
          );

          let props: HookProps = {
            sourceMode: "live",
            supportsWholeChannelSampleRate: true,
            activeChannelSampleRate: CHANNELS[0].span,
            activeSignalAreaBounds: {
              min: CHANNELS[0].min,
              max: CHANNELS[0].min + CHANNELS[0].span,
            },
            frequencyRange: { min: 18_000, max: 18_000 + CHANNELS[0].span },
            sampleRateHz: RECEIVE_FLOOR_HZ,
            maxSampleRateHz: HACKRF_CEILING_HZ,
            setSampleRate,
            setSampleRateWithFrequencyRange,
            applyFrequencyRange,
          };

          const { result, rerender } = renderHook(
            (next: HookProps) => useLiveSampleRateControl(next),
            { initialProps: props },
          );

          const effectiveRate = () =>
            appliedRates.length > 0
              ? appliedRates[appliedRates.length - 1]
              : (props.sampleRateHz as number);

          // The optimistic write of our own request reaches the hook as the
          // rate prop, which is what clears the hook's pending request. Mirror
          // that so "outstanding request" means the same thing here.
          const acknowledgeSelf = () => {
            const pending = pendingRequestRef.current;
            const prop = props.sampleRateHz;
            if (
              pending !== null &&
              typeof prop === "number" &&
              Math.abs(prop - pending) <= RATE_TOLERANCE_HZ
            ) {
              pendingRequestRef.current = null;
              deviceRateRef.current = pending;
            }
          };

          const check = () => {
            const { isWholeChannelMode, wholeChannelSampleRate } =
              result.current;

            // INV-1
            for (const rate of appliedRates) {
              expect(Number.isFinite(rate)).toBe(true);
              expect(rate).toBeGreaterThan(0);
            }
            // INV-2: a published rate and its window cannot drift apart.
            for (const window of appliedWindows) {
              expect(window.span).toBe(Math.round(window.rate));
            }
            // INV-3: the claim and the effective rate must agree.
            if (isWholeChannelMode) {
              expect(wholeChannelSampleRate).not.toBeNull();
              expect(effectiveRate()).toBe(
                Math.round(wholeChannelSampleRate as number),
              );
            }
            // INV-5: a republished viewport must match the width the device is
            // actually running at. This is the "whole channel is wrong, and now
            // no other rate sticks either" report: while the claim was sticky,
            // the window reconciler kept re-publishing the whole-channel width
            // even though the source was acquiring a different rate, so every
            // manual rate was immediately fought by the view.
            const desyncedWindows = viewWindows.filter(
              (view) =>
                view.deviceRate !== null &&
                Math.abs(view.span - Math.round(view.deviceRate)) >
                  RATE_TOLERANCE_HZ,
            );
            expect(desyncedWindows).toEqual([]);
          };

          try {
            for (const event of events) {
              switch (event.kind) {
                case "selectManual": {
                  trace.push(`selectManual(${event.rate})`);
                  act(() => {
                    result.current.handleSampleRateChange(event.rate, "manual");
                  });
                  // The optimistic Redux write comes back as the rate prop.
                  props = { ...props, sampleRateHz: event.rate };
                  rerender(props);
                  acknowledgeSelf();
                  check();
                  break;
                }
                case "selectWhole": {
                  const wholeChannelRate =
                    result.current.wholeChannelSampleRate;
                  if (wholeChannelRate === null) break;
                  trace.push(`selectWhole()`);
                  act(() => {
                    result.current.handleSampleRateChange(
                      wholeChannelRate,
                      "whole",
                    );
                  });
                  props = { ...props, sampleRateHz: wholeChannelRate };
                  rerender(props);
                  acknowledgeSelf();
                  check();
                  break;
                }
                case "echoRate": {
                  // The backend/source snapshot echoes a rate. It may be stale:
                  // it must not silently move the effective acquisition away
                  // from the current selection.
                  trace.push(`echoRate(${event.rate})`);
                  props = { ...props, sampleRateHz: event.rate };
                  const outstanding = pendingRequestRef.current;
                  if (outstanding === null) {
                    // No request in flight: the snapshot is authoritative.
                    deviceRateRef.current = event.rate;
                  } else if (
                    Math.abs(event.rate - outstanding) <= RATE_TOLERANCE_HZ
                  ) {
                    // Acknowledgement of our request.
                    pendingRequestRef.current = null;
                    deviceRateRef.current = outstanding;
                  }
                  // Otherwise it contradicts an outstanding request and is
                  // stale: the belief does not move.
                  rerender(props);
                  check();
                  break;
                }
                case "switchChannel": {
                  // Telemetry: the active channel changed (pan / backend
                  // active-area change) without an explicit channel click.
                  trace.push(`switchChannel(${event.min},${event.span})`);
                  props = {
                    ...props,
                    activeChannelSampleRate: event.span,
                    activeSignalAreaBounds: {
                      min: event.min,
                      max: event.min + event.span,
                    },
                  };
                  rerender(props);
                  check();
                  break;
                }
                case "pan": {
                  trace.push(`pan(${event.min},${event.span})`);
                  props = {
                    ...props,
                    frequencyRange: {
                      min: event.min,
                      max: event.min + event.span,
                    },
                  };
                  rerender(props);
                  check();
                  break;
                }
              }
            }
          } catch (error) {
            throw new Error(
              `${(error as Error).message}\nEvent trace: ${trace.join(" -> ")}`,
            );
          }
        },
      ),
      { numRuns: 250 },
    );
  });

  it("INV-4: an explicit manual rate is not resurrected by a stale whole-channel span", () => {
    fc.assert(
      fc.property(
        rateArb,
        channelArb,
        channelArb,
        (manualRate, startChannel, nextChannel) => {
          const setSampleRate = jest.fn();
          const appliedRates: number[] = [];
          const record = jest.fn((rate: number) => {
            appliedRates.push(rate);
          });

          const initialProps: HookProps = {
            sourceMode: "live",
            supportsWholeChannelSampleRate: true,
            activeChannelSampleRate: startChannel.span,
            activeSignalAreaBounds: {
              min: startChannel.min,
              max: startChannel.min + startChannel.span,
            },
            frequencyRange: {
              min: startChannel.min,
              max: startChannel.min + startChannel.span,
            },
            sampleRateHz: startChannel.span,
            maxSampleRateHz: HACKRF_CEILING_HZ,
            setSampleRate,
            setSampleRateWithFrequencyRange: record,
            applyFrequencyRange: jest.fn(),
          };

          const { result, rerender } = renderHook(
            (next: HookProps) => useLiveSampleRateControl(next),
            { initialProps },
          );

          fc.pre(manualRate !== startChannel.span);

          act(() => {
            result.current.handleSampleRateChange(manualRate, "manual");
          });
          expect(record).toHaveBeenLastCalledWith(
            manualRate,
            expect.anything(),
          );

          appliedRates.length = 0;

          // Pan into another channel and let the backend echo arbitrary rates.
          rerender({
            ...initialProps,
            activeChannelSampleRate: nextChannel.span,
            activeSignalAreaBounds: {
              min: nextChannel.min,
              max: nextChannel.min + nextChannel.span,
            },
            sampleRateHz: manualRate,
          });
          rerender({
            ...initialProps,
            activeChannelSampleRate: nextChannel.span,
            activeSignalAreaBounds: {
              min: nextChannel.min,
              max: nextChannel.min + nextChannel.span,
            },
            sampleRateHz: RECEIVE_FLOOR_HZ,
          });

          // The user's manual choice survives panning, channel changes and a
          // stale 3.2 MHz echo.
          expect(appliedRates.filter((rate) => rate !== manualRate)).toEqual(
            [],
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

interface SelectorCase {
  sampleRate: number;
  wholeChannelSampleRate: number | null;
  isWholeChannelMode: boolean;
  sampleRateOptions: number[];
}

const selectorCaseArb: fc.Arbitrary<SelectorCase> = fc
  .tuple(
    rateArb,
    fc.option(channelArb, { nil: null }),
    fc.boolean(),
    fc.array(rateArb, { maxLength: 5 }),
  )
  .map(([sampleRate, wholeChannel, isWholeChannelMode, options]) => ({
    sampleRate,
    wholeChannelSampleRate: wholeChannel ? wholeChannel.span : null,
    isWholeChannelMode,
    sampleRateOptions: Array.from(new Set([...options, sampleRate])).sort(
      (a, b) => a - b,
    ),
  }));

describe("Signal Display Whole Channel selector fuzz", () => {
  it("INV-3: the selector and the reported rate can never disagree", () => {
    fc.assert(
      fc.property(selectorCaseArb, (testCase) => {
        // The hook only reports a whole-channel claim alongside a whole-channel
        // rate (canUseWholeChannel gates on the rate), so model that reachable
        // input space here; the claim-without-a-target case has its own test.
        fc.pre(
          !testCase.isWholeChannelMode ||
            testCase.wholeChannelSampleRate !== null,
        );

        const { unmount } = render(
          <TestWrapper>
            <SignalDisplaySection
              variant="default"
              sourceMode="live"
              maxSampleRate={HACKRF_CEILING_HZ}
              minReceiveSampleRate={RECEIVE_FLOOR_HZ}
              sampleRate={testCase.sampleRate}
              sampleRateOptions={testCase.sampleRateOptions}
              wholeChannelSampleRate={testCase.wholeChannelSampleRate}
              isWholeChannelMode={testCase.isWholeChannelMode}
              wholeChannelLabel={null}
              fileCapturedRange={null}
              fftFrameRate={12}
              maxFrameRate={60}
              fftSize={262144}
              fftSizeOptions={[262144]}
              fftWindow="Rectangular"
              temporalResolution="reduced"
              backend="hackrf_one"
              deviceProfile={{
                kind: "hackrf_one",
                is_rtl_sdr: false,
                supports_approx_dbm: false,
              }}
              powerScale="dB"
              onFftFrameRateChange={jest.fn()}
              onFftSizeChange={jest.fn()}
              onFftWindowChange={jest.fn()}
              onTemporalResolutionChange={jest.fn()}
              onPowerScaleChange={jest.fn()}
              onSampleRateChange={jest.fn()}
              scheduleCoupledAdjustment={jest.fn()}
            />
          </TestWrapper>,
        );

        try {
          const row = screen.getAllByText("Sample Rate")[0].closest("div")
            ?.parentElement as HTMLElement;
          const select = within(row).getByRole("combobox") as HTMLSelectElement;

          const wholeChannelOption = Array.from(select.options).find(
            (option) => option.value === "whole-channel",
          );

          if (testCase.isWholeChannelMode) {
            // Claiming Whole Channel requires a real target and the selector
            // must render that claim.
            expect(wholeChannelOption).toBeDefined();
            expect(select).toHaveValue("whole-channel");
            const expected = Math.round(
              testCase.wholeChannelSampleRate as number,
            );
            const shown = [...select.options].map((option) => option.value);
            expect(
              shown.includes("whole-channel") ||
                shown.includes(String(expected)),
            ).toBe(true);
          } else {
            expect(select).toHaveValue(String(testCase.sampleRate));
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: 60 },
    );
  });

  const renderSelector = (
    overrides: Partial<React.ComponentProps<typeof SignalDisplaySection>>,
  ) =>
    render(
      <TestWrapper>
        <SignalDisplaySection
          variant="default"
          sourceMode="live"
          maxSampleRate={HACKRF_CEILING_HZ}
          minReceiveSampleRate={RECEIVE_FLOOR_HZ}
          sampleRate={RECEIVE_FLOOR_HZ}
          sampleRateOptions={[RECEIVE_FLOOR_HZ, 5_200_000, HACKRF_CEILING_HZ]}
          wholeChannelSampleRate={null}
          fileCapturedRange={null}
          fftFrameRate={12}
          maxFrameRate={60}
          fftSize={262144}
          fftSizeOptions={[262144]}
          fftWindow="Rectangular"
          temporalResolution="reduced"
          backend="hackrf_one"
          deviceProfile={{
            kind: "hackrf_one",
            is_rtl_sdr: false,
            supports_approx_dbm: false,
          }}
          powerScale="dB"
          onFftFrameRateChange={jest.fn()}
          onFftSizeChange={jest.fn()}
          onFftWindowChange={jest.fn()}
          onTemporalResolutionChange={jest.fn()}
          onPowerScaleChange={jest.fn()}
          onSampleRateChange={jest.fn()}
          scheduleCoupledAdjustment={jest.fn()}
          {...overrides}
        />
      </TestWrapper>,
    );

  const readSampleRateSelect = () => {
    const row = screen.getAllByText("Sample Rate")[0].closest("div")
      ?.parentElement as HTMLElement;
    return within(row).getByRole("combobox") as HTMLSelectElement;
  };

  it("INV-3 (fail closed): a claim without a Whole Channel target renders the numeric rate", () => {
    renderSelector({
      isWholeChannelMode: true,
      wholeChannelSampleRate: null,
    });

    const select = readSampleRateSelect();
    expect(
      Array.from(select.options).some(
        (option) => option.value === "whole-channel",
      ),
    ).toBe(false);
    expect(select).toHaveValue(String(RECEIVE_FLOOR_HZ));
  });

  it("INV-3 (fail closed): an RTL-SDR never renders a Whole Channel selection", () => {
    renderSelector({
      isWholeChannelMode: true,
      wholeChannelSampleRate: 5_200_000,
      backend: "rtl_sdr",
      deviceProfile: {
        kind: "rtl_sdr",
        is_rtl_sdr: true,
        supports_approx_dbm: false,
      },
    });

    const select = readSampleRateSelect();
    expect(
      Array.from(select.options).some(
        (option) => option.value === "whole-channel",
      ),
    ).toBe(false);
    // Without the fail-closed guard the browser would fall back to the first
    // option while the component reported "whole-channel".
    expect(select).toHaveValue(String(RECEIVE_FLOOR_HZ));
  });
});

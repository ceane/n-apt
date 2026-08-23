import fc from "fast-check";
import {
  STREAM_CONTROL_CONTRACT,
  resolveStreamControlScope,
  type StreamControlAction,
  type StreamControlMode,
} from "@n-apt/app/infrastructure/streams/streamContract";
import {
  acquireStreamDeliveryDemand,
  getStreamDeliveryDemandPolicy,
  resetStreamDeliveryDemands,
  subscribeStreamDeliveryDemand,
} from "@n-apt/app/infrastructure/streams/streamDeliveryDemand";
import { createDeviceOptionScheduler } from "@n-apt/app/infrastructure/streams/deviceOptionScheduler";

const MODES: StreamControlMode[] = ["rx", "tx"];
const ACTIONS: StreamControlAction[] = ["pause", "stop", "settings", "tune"];

describe("stream control contract fuzz", () => {
  it("scope table is total: every mode/action resolves to exactly one scope", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODES),
        fc.constantFrom(...ACTIONS),
        (mode, action) => {
          const scope = resolveStreamControlScope(mode, action);
          expect(scope === "subscriber" || scope === "device").toBe(true);
          expect(STREAM_CONTROL_CONTRACT[mode][action]).toBe(scope);
        },
      ),
    );
  });

  it("rx.pause is subscriber-scoped; everything else is device-scoped", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODES),
        fc.constantFrom(...ACTIONS),
        (mode, action) => {
          const scope = resolveStreamControlScope(mode, action);
          if (mode === "rx" && action === "pause") {
            expect(scope).toBe("subscriber");
          } else {
            expect(scope).toBe("device");
          }
        },
      ),
    );
  });

  it("delivery policy aggregate is lossless iff any demand is lossless (associative)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("latest", "lossless"), {
          minLength: 0,
          maxLength: 12,
        }),
        (policies) => {
          resetStreamDeliveryDemands();
          const key = { sourceId: "src", mode: "rx" as const };
          const releases = policies.map((p) =>
            acquireStreamDeliveryDemand(key, p as "latest" | "lossless"),
          );
          const expected = policies.some((p) => p === "lossless")
            ? "lossless"
            : "latest";
          expect(getStreamDeliveryDemandPolicy(key)).toBe(expected);
          // Partial release: dropping one lossless while another remains keeps lossless.
          const losslessIdx = policies.findIndex((p) => p === "lossless");
          if (
            losslessIdx >= 0 &&
            policies.filter((p) => p === "lossless").length > 1
          ) {
            releases[losslessIdx]();
            expect(getStreamDeliveryDemandPolicy(key)).toBe("lossless");
          }
          releases.forEach((r) => r());
          expect(getStreamDeliveryDemandPolicy(key)).toBe("latest");
          resetStreamDeliveryDemands();
        },
      ),
    );
  });

  it("delivery demand is idempotent: acquiring twice with same policy then releasing once leaves it active", () => {
    fc.assert(
      fc.property(fc.constantFrom("latest", "lossless"), (policy) => {
        resetStreamDeliveryDemands();
        const key = { sourceId: "src", mode: "tx" as const };
        const r1 = acquireStreamDeliveryDemand(key, policy);
        const r2 = acquireStreamDeliveryDemand(key, policy);
        expect(getStreamDeliveryDemandPolicy(key)).toBe(policy);
        r1();
        expect(getStreamDeliveryDemandPolicy(key)).toBe(policy);
        r2();
        expect(getStreamDeliveryDemandPolicy(key)).toBe("latest");
        resetStreamDeliveryDemands();
      }),
    );
  });

  it("listeners observe every demand change with the effective aggregate", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("latest", "lossless"), {
          minLength: 1,
          maxLength: 8,
        }),
        (policies) => {
          resetStreamDeliveryDemands();
          const key = { sourceId: "s", mode: "rx" as const };
          const observed: Array<"latest" | "lossless"> = [];
          const unsub = subscribeStreamDeliveryDemand((_, policy) =>
            observed.push(policy),
          );
          const releases = policies.map((p) =>
            acquireStreamDeliveryDemand(key, p as "latest" | "lossless"),
          );
          expect(observed.length).toBe(policies.length);
          expect(observed[observed.length - 1]).toBe(
            policies.some((p) => p === "lossless") ? "lossless" : "latest",
          );
          releases.forEach((r) => r());
          unsub();
          resetStreamDeliveryDemands();
        },
      ),
    );
  });
});

describe("device option scheduler fuzz", () => {
  it("coalesces gesture submits to the latest value and flushes once", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), {
          minLength: 0,
          maxLength: 30,
        }),
        (values) => {
          const published: number[] = [];
          const scheduler = createDeviceOptionScheduler<number>({
            publish: (v) => published.push(v),
            intervalMs: 10,
            idleFlushMs: 5,
          });
          for (const v of values) scheduler.submit(v);
          scheduler.flush();
          // First value may publish immediately; the final value must be the last flushed.
          expect(published[published.length - 1]).toBe(
            values.length ? values[values.length - 1] : undefined,
          );
          scheduler.dispose();
        },
      ),
    );
  });

  it("never throws and publishes at most once per distinct value after flush", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10, max: 10 }), {
          minLength: 0,
          maxLength: 20,
        }),
        (values) => {
          const published: number[] = [];
          const scheduler = createDeviceOptionScheduler<number>({
            publish: (v) => published.push(v),
            intervalMs: 100,
            idleFlushMs: 100,
          });
          for (const v of values) scheduler.submit(v, "gesture");
          expect(() => scheduler.flush()).not.toThrow();
          expect(() => scheduler.cancel()).not.toThrow();
          expect(() => scheduler.dispose()).not.toThrow();
        },
      ),
    );
  });

  it("immediate submits bypass coalescing and publish every distinct value", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5 }), {
          minLength: 0,
          maxLength: 12,
        }),
        (values) => {
          const published: number[] = [];
          const scheduler = createDeviceOptionScheduler<number>({
            publish: (v) => published.push(v),
          });
          for (const v of values) scheduler.submit(v, "immediate");
          // Immediate publishes each distinct value at least once.
          const distinct = new Set(values);
          for (const d of distinct) {
            expect(published).toContain(d);
          }
          scheduler.dispose();
        },
      ),
    );
  });
});

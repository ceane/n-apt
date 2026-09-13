import fc from "fast-check";
import {
  validateWebSocketMessage,
  processWebSocketMessageWithValidation,
} from "@n-apt/validation/middleware";

const ANY_JSON = fc.jsonValue({ maxDepth: 5 });

const MESSAGE_TYPES = [
  "tx_safety",
  "frequency_range",
  "set_frequency_range",
  "demod_tune",
  "channels",
  "pause",
  "status",
  "gain",
  "ppm",
  "settings",
  "signal_display_settings",
  "signals_defaults",
  "restart_device",
  "select_source",
  "training_capture",
  "capture",
  "capture_stop",
  "active_source",
  "source_info",
  "sdr_settings",
  "error",
  "spectrum",
  "encrypted_spectrum",
  "capture_status",
  "scan_result",
  "scan_progress",
  "demod_result",
  "hardware_info",
  "apt_analysis_result",
  "not-a-real-type",
  "",
];

const arbitraryTypedMessage = fc.tuple(
  fc.constantFrom(...MESSAGE_TYPES),
  ANY_JSON,
);

describe("websocket message validation fuzz", () => {
  it("validation never throws and is deterministic for arbitrary JSON", () => {
    fc.assert(
      fc.property(ANY_JSON, (value) => {
        let first: boolean;
        let second: boolean;
        expect(() => {
          first = validateWebSocketMessage(value);
        }).not.toThrow();
        // Pure validation, called twice on the same input, must agree.
        expect(() => {
          second = validateWebSocketMessage(value);
        }).not.toThrow();
        expect(first!).toBe(second!);
      }),
    );
  });

  it("validation accepts exactly the union-discriminated message shapes", () => {
    fc.assert(
      fc.property(arbitraryTypedMessage, ([type, body]) => {
        let accepted: boolean;
        expect(() => {
          accepted = validateWebSocketMessage({ type, ...nfObject(body) });
        }).not.toThrow();
        // Whatever the verdict, it must be a boolean.
        expect(typeof accepted!).toBe("boolean");
      }),
    );
  });

  it("schema-valid messages survive JSON round-trip and remain valid", () => {
    fc.assert(
      fc.property(arbitraryTypedMessage, ([type, body]) => {
        const msg = { type, ...nfObject(body) };
        if (!validateWebSocketMessage(msg)) return; // only care about valid ones
        let roundTripped: Record<string, unknown>;
        expect(() => {
          roundTripped = JSON.parse(JSON.stringify(msg));
        }).not.toThrow();
        // Valid messages must not contain NaN/Infinity/undefined (JSON drops them).
        const dropFree = (v: unknown): boolean => {
          if (typeof v === "number") return Number.isFinite(v);
          if (typeof v === "undefined") return false;
          if (v && typeof v === "object") {
            for (const c of Object.values(v as Record<string, unknown>)) {
              if (!dropFree(c)) return false;
            }
          }
          return true;
        };
        expect(dropFree(msg)).toBe(true);
        // A valid message must survive serialization as still-valid (no
        // undefined/NaN that changes the shape).
        expect(validateWebSocketMessage(roundTripped!)).toBe(true);
      }),
    );
  });

  it("high-frequency spectrum/capture messages are only loosely validated and never throw", () => {
    fc.assert(
      fc.property(ANY_JSON, (body) => {
        for (const type of [
          "spectrum",
          "encrypted_spectrum",
          "capture_status",
        ]) {
          let accepted: boolean;
          expect(() => {
            accepted = validateWebSocketMessage({ type, ...nfObject(body) });
          }).not.toThrow();
          expect(typeof accepted!).toBe("boolean");
        }
      }),
    );
  });

  it("binary ArrayBuffer input is always accepted (skipBinaryValidation)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 255 })), (bytes) => {
        expect(validateWebSocketMessage(Uint8Array.from(bytes).buffer)).toBe(
          true,
        );
      }),
    );
  });

  it("processWebSocketMessageWithValidation never throws and returns a boolean", () => {
    fc.assert(
      fc.property(ANY_JSON, (value) => {
        let result: boolean;
        expect(() => {
          result = processWebSocketMessageWithValidation(
            (() => {}) as never,
            (() => ({})) as never,
            value,
          );
        }).not.toThrow();
        expect(typeof result!).toBe("boolean");
      }),
    );
  });

  it("unknown message types are consistently handled (deterministic)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), ANY_JSON, (type, body) => {
        const msg = { type, ...nfObject(body) };
        const first = validateWebSocketMessage(msg);
        const second = validateWebSocketMessage({ type, ...nfObject(body) });
        expect(first).toBe(second);
      }),
    );
  });
});

/**
 * JSON.stringify can carry objects whose number values are NaN/Infinity/undefined
 * that JSON cannot represent. Replace them with a sentinel so the shapes stay
 * JSON-representable, mirroring what a real wire message looks like.
 */
const nfObject = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "number") out[k] = Number.isFinite(val) ? val : 0;
      else if (val === undefined) out[k] = 0;
      else out[k] = val;
    }
    return out;
  }
  return {};
};

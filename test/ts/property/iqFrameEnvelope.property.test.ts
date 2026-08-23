import fc from "fast-check";
import { decodeIqFrameEnvelope } from "@n-apt/app/infrastructure/io/iqStreamProtocol";

const V2_MAGIC = [0x4e, 0x41, 0x50, 0x54];

/** A valid v2-format buffer for round-trip tests. */
const buildValidV2Buffer = (
  sourceId: string,
  sequence: number,
  epoch: number,
  payloadLen: number,
): ArrayBuffer => {
  const srcBytes = new TextEncoder().encode(sourceId);
  const headerLen = 56 + srcBytes.length;
  const buf = new ArrayBuffer(headerLen + payloadLen);
  const bytes = new Uint8Array(buf);
  bytes.set(V2_MAGIC, 0);
  const view = new DataView(buf);
  view.setUint8(4, 2); // version
  view.setUint8(5, 1); // flags
  view.setUint16(6, headerLen, true);
  view.setUint16(8, srcBytes.length, true);
  view.setUint8(10, 0); // frame_status = receiving
  view.setBigUint64(16, BigInt(epoch), true);
  view.setBigUint64(24, BigInt(sequence), true);
  view.setBigUint64(32, BigInt(1_600_000_000_000), true); // timestamp
  view.setBigUint64(40, BigInt(137_100_000), true); // center_frequency
  view.setUint32(48, 1, true); // data_type = iq_raw
  view.setUint32(52, 2_400_000, true); // sample_rate
  bytes.set(srcBytes, 56);
  for (let i = 0; i < payloadLen; i++) {
    bytes[headerLen + i] = (i * 7) & 0xff;
  }
  return buf;
};

const BYTE_ARRAY = fc.array(fc.integer({ min: 0, max: 255 }), {
  minLength: 0,
  maxLength: 4096,
});

/** A non-empty source id that survives the decoder's trim()/empty check. */
const SAFE_SOURCE_ID = fc
  .array(fc.constantFrom("a", "b", "c", "1", "-", "_"), {
    minLength: 1,
    maxLength: 32,
  })
  .map((parts) => parts.join(""));

describe("IQ frame envelope decoder fuzz", () => {
  it("decoding arbitrary bytes never throws an unexpected error", () => {
    fc.assert(
      fc.property(BYTE_ARRAY, fc.string(), (bytes, sourceId) => {
        const buf = new Uint8Array(bytes).buffer;
        const result: unknown = (() => {
          try {
            return decodeIqFrameEnvelope(buf, sourceId);
          } catch (e) {
            return e;
          }
        })();
        if (result instanceof Error) {
          // Only documented decode errors are acceptable.
          expect(result.message).toMatch(/Invalid I\/Q frame/);
        } else {
          const frame = result as {
            metadata: Record<string, unknown>;
            encryptedPayload: Uint8Array;
          };
          expect(frame.encryptedPayload).toBeInstanceOf(Uint8Array);
          expect(frame.metadata.source_id).toEqual(expect.any(String));
        }
      }),
    );
  });

  it("short buffers always throw the v1-short error, never a runtime crash", () => {
    fc.assert(
      fc.property(
        BYTE_ARRAY.map((b) => b.slice(0, 23)),
        (bytes) => {
          expect(() =>
            decodeIqFrameEnvelope(new Uint8Array(bytes).buffer, "s"),
          ).toThrow("Invalid I/Q frame: shorter than the v1 header");
        },
      ),
    );
  });

  it("v2 magic-prefixed but truncated buffers throw a documented error", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 255 }), {
          minLength: 0,
          maxLength: 51,
        }),
        (tail) => {
          const buf = new Uint8Array(4 + tail.length);
          buf.set(V2_MAGIC, 0);
          buf.set(tail, 4);
          expect(() => decodeIqFrameEnvelope(buf.buffer, "s")).toThrow(
            /Invalid I\/Q frame/,
          );
        },
      ),
    );
  });

  it("successful v2 decode yields finite, non-negative lifecycle fields", () => {
    fc.assert(
      fc.property(
        SAFE_SOURCE_ID,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 1, max: 2048 }),
        (sourceId, sequence, epoch, payloadLen) => {
          const buf = buildValidV2Buffer(sourceId, sequence, epoch, payloadLen);
          const frame = decodeIqFrameEnvelope(buf, "fallback");
          expect(frame.metadata.protocol_version).toBe(2);
          expect(frame.metadata.source_id).toEqual(sourceId);
          expect(frame.metadata.sequence).toBeGreaterThanOrEqual(0);
          expect(frame.metadata.stream_epoch).toBeGreaterThanOrEqual(0);
          expect(frame.metadata.sample_rate).toBeGreaterThan(0);
          expect(Number.isFinite(frame.metadata.sample_rate)).toBe(true);
          expect(frame.encryptedPayload.length).toBe(payloadLen);
        },
      ),
    );
  });

  it("v2 decode round-trips payload bytes exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 1 << 30 }),
        (seq, epoch) => {
          const buf = buildValidV2Buffer("a", seq, epoch, 100);
          const frame = decodeIqFrameEnvelope(buf, "fallback");
          expect(frame.encryptedPayload).toEqual(
            new Uint8Array(buf).subarray(
              frame.metadata.protocol_version === 2 ? 57 : 24,
            ),
          );
        },
      ),
    );
  });

  it("valid v1 (non-magic) buffers parse the legacy 24-byte header", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 1, max: 100 }),
        (timestamp, payloadLen) => {
          const buf = new ArrayBuffer(24 + payloadLen);
          const view = new DataView(buf);
          view.setBigUint64(0, BigInt(timestamp), true);
          view.setBigUint64(8, BigInt(100_000_000), true); // center
          view.setUint32(16, 1, true); // dataType=1
          view.setUint32(20, 2_400_000, true); // sampleRate
          const bytes = new Uint8Array(buf);
          for (let i = 24; i < 24 + payloadLen; i++) bytes[i] = i & 0xff;
          const frame = decodeIqFrameEnvelope(buf, "src");
          expect(frame.metadata.protocol_version).toBe(1);
          expect(frame.metadata.source_id).toBe("src");
          expect(frame.metadata.timestamp).toBe(timestamp);
          expect(Number.isFinite(frame.metadata.timestamp)).toBe(true);
        },
      ),
    );
  });
});

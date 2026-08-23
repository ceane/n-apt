import { makeFrame } from "@n-apt/app/infrastructure/streams/multiplexedStreamTransport";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";

jest.mock("@n-apt/crypto/webcrypto", () => ({
  decryptPayloadBytes: jest.fn(),
}));

const decryptPayloadBytesMock = decryptPayloadBytes as jest.Mock;
decryptPayloadBytesMock.mockImplementation(async () =>
  new Uint8Array(2048).fill(128),
);

/**
 * Ingress tagging contract (docs/architecture/multiplex-stream-pipeline.md §5):
 * the multiplexed transport NEVER emits standby/preview-tagged frames. Those
 * tags are exclusive to the legacy control-socket one-shot path, and the
 * middleware batch gate keys on them. If this test fails, preview frames have
 * started flowing through the transport — the gate semantics and the doc must
 * be revisited before shipping.
 */
describe("multiplexed stream ingress tagging contract", () => {
  const aesKeyImport = async (): Promise<CryptoKey> => {
    const raw = new Uint8Array(32).fill(7);
    return crypto.subtle.importKey("raw", raw.buffer, { name: "AES-GCM" }, true, [
      "decrypt",
    ]);
  };

  const frameMessage = (overrides: Record<string, unknown> = {}) => ({
    type: "stream_frame",
    sourceId: "mock-tx",
    mode: "tx",
    sequence: 4,
    streamEpoch: 2,
    optionsRevision: 1,
    timestamp: 1_700,
    centerFrequencyHz: 100_000_000,
    sampleRateHz: 2_400_000,
    iqData: "ZmFrZQ==",
    ...overrides,
  });

  it.each([["rx"], ["tx"]])(
    "emits only receiving/transmitting frame_status for %s streams",
    async (mode) => {
      const event = await makeFrame(frameMessage({ mode }), await aesKeyImport());
      expect(event.type).toBe("stream_frame");
      if (event.type !== "stream_frame") return;
      expect(["receiving", "transmitting"]).toContain(event.frame.frame_status);
      expect(event.frame.frame_status === "standby").toBe(false);
      expect((event.frame as Record<string, unknown>).is_tx_preview).toBeUndefined();
      expect(
        (event.frame as Record<string, unknown>).is_mock_tx_preview,
      ).toBeUndefined();
    },
  );

  it("never emits standby tags even when the message claims a standby status", async () => {
    const event = await makeFrame(
      frameMessage({ frame_status: "standby" }),
      await aesKeyImport(),
    );
    if (event.type !== "stream_frame") return;
    expect(event.frame.frame_status).not.toBe("standby");
  });
});

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
 * a Mock Tx one-shot preview retains its standby identity across the
 * multiplexed stream. The presentation lifecycle must therefore accept it
 * while Mock APT remains the active receive processor.
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
    "emits receiving/transmitting frame_status for ordinary %s streams",
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

  it("preserves a Mock Tx one-shot as a standby preview", async () => {
    const event = await makeFrame(
      frameMessage({ isTxPreview: true }),
      await aesKeyImport(),
    );
    if (event.type !== "stream_frame") return;
    expect(event.frame.frame_status).toBe("standby");
    expect(event.frame.is_tx_preview).toBe(true);
  });
});

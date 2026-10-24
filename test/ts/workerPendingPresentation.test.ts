import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { canReuseResidentSpectrumWhileWorkerPending } from "@n-apt/spectrum/fft/frameProcessing";

const frame = (overrides: Partial<LiveFrameData> = {}) => ({
  type: "spectrum",
  data_type: "iq_raw",
  source_id: "mock-apt",
  stream_epoch: 4,
  options_revision: 2,
  sequence: 10,
  timestamp: 100,
  sample_rate: 3_200_000,
  center_frequency_hz: 10_000_000,
  iq_data: new Uint8Array(32),
  ...overrides,
}) as LiveFrameData;

describe("resident spectrum while a replacement FFT is pending", () => {
  test("reuses a resident frame from the same source epoch and presentation mode", () => {
    const incoming = frame({
      options_revision: 3,
      sequence: 11,
      center_frequency_hz: 11_000_000,
    });

    expect(canReuseResidentSpectrumWhileWorkerPending(incoming, frame())).toBe(true);
  });

  test.each([
    ["source", frame({ source_id: "mock-tx" })],
    ["stream epoch", frame({ stream_epoch: 5 })],
    ["presentation mode", frame({ is_tx_preview: true })],
  ])("rejects a resident frame from another %s", (_label, resident) => {
    expect(
      canReuseResidentSpectrumWhileWorkerPending(frame(), resident),
    ).toBe(false);
  });

  test("requires explicit source and stream epoch ownership", () => {
    const legacy = frame({ protocol_version: 1, stream_epoch: undefined });
    expect(
      canReuseResidentSpectrumWhileWorkerPending(frame(), legacy),
    ).toBe(false);
  });

  test("does not reuse a standby or preview frame for active transmit", () => {
    expect(
      canReuseResidentSpectrumWhileWorkerPending(
        frame({ frame_status: "transmitting" }),
        frame({ frame_status: "standby", is_tx_preview: true }),
      ),
    ).toBe(false);
    expect(
      canReuseResidentSpectrumWhileWorkerPending(
        frame({ is_tx_preview: true }),
        frame({ is_mock_tx_preview: true }),
      ),
    ).toBe(false);
  });
});

/**
 * Validation of the `source_info` payload against the schema and the
 * Redux reducer that maps it into device state. No backend is involved;
 * this guards the contract between the two layers.
 */

import { isValidSourceInfoMessage } from "@n-apt/validation";
import { updateDeviceState } from "@n-apt/redux/slices/websocketSlice";

describe("source_info payload validation and Redux mapping", () => {
  test("should validate and map a source_info snapshot", () => {
    const sourceInfoMessage = {
      type: "source_info",
      active_source: "mock-apt",
      active_source_mode: "live",
      sources: [
        {
          id: "mock-apt",
          name: "Mock APT SDR",
          kind: "mock_apt",
          capability: "mock",
          status: "streaming",
          loading_attempt: 0,
          loading_attempt_max: 3,
          supports_approx_dbm: true,
          iq_format: {
            element_type: "u8",
            layout: "interleaved_iq",
            typed_array: "Uint8Array",
          },
          sdr: {
            max_sample_rate: 3200000,
            sample_rate_options: [3200000],
            fft_display: { markers: [] },
            settings: {
              sample_rate: 3200000,
              center_frequency: 1600000,
              fft: {
                default_size: 2048,
                default_frame_rate: 30,
                max_size: 65536,
                max_frame_rate: 60,
              },
              display: {
                min_db: -150,
                max_db: 0,
                padding: 10,
              },
            },
          },
        },
      ],
    };

    expect(isValidSourceInfoMessage(sourceInfoMessage)).toBe(true);

    const updates: any = {
      activeSourceId: sourceInfoMessage.active_source,
      activeSourceMode: sourceInfoMessage.active_source_mode as "live" | "file",
      sources: sourceInfoMessage.sources,
    };

    const action = updateDeviceState(updates);
    expect(action.payload.activeSourceId).toBe("mock-apt");
    expect(action.payload.sources).toHaveLength(1);
  });
});

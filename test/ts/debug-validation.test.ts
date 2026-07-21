/**
 * Debug test to understand validation failures
 */

import {
  validateWebSocketMessage,
  isValidSourceInfoMessage,
} from "@n-apt/validation";

describe("Debug WebSocket Validation", () => {
  test("should validate the actual failing messages", () => {
    // Test the exact message from the error
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
          supports_raw_iq_stream: true,
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

    console.log(
      "Source info validation result:",
      isValidSourceInfoMessage(sourceInfoMessage),
    );
    console.log(
      "WebSocket message validation result:",
      validateWebSocketMessage(sourceInfoMessage),
    );
  });
});

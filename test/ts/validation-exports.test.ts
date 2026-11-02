/**
 * Simple test to verify validation exports work
 */

import {
  validateSpectrumDataComprehensive,
  validateWaterfallDataComprehensive,
  validateWebSocketMessage,
} from "@n-apt/validation";

describe("Validation Exports", () => {
  test("should export comprehensive validation functions", () => {
    expect(typeof validateSpectrumDataComprehensive).toBe("function");
    expect(typeof validateWaterfallDataComprehensive).toBe("function");
  });

  test("should export WebSocket validation", () => {
    expect(typeof validateWebSocketMessage).toBe("function");

    // Test with a valid WebSocket message structure
    const validMessage = {
      type: "select_source",
      source_id: "mock-apt",
    };
    const result = validateWebSocketMessage(validMessage);
    expect(result).toBe(true);

    expect(validateWebSocketMessage({ type: "not-a-real-type" })).toBe(false);
  });
});

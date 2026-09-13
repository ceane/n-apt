import { isValidFrequency } from "@n-apt/validation/guards";
import { parseFrequency } from "@n-apt/math/frequency";

/**
 * Unit coverage for the two pure frequency helpers used at the frontend
 * boundary: isValidFrequency (range guard) and parseFrequency (string
 * parsing). The real backend->WebSocket->store pipeline is exercised
 * elsewhere by the live-stream integration suites.
 */
describe("isValidFrequency guard and parseFrequency parsing", () => {
  it("should validate a typical high-frequency satellite range (137.5 MHz)", () => {
    expect(isValidFrequency(137_500_000)).toBe(true);
  });

  it("should validate ultra-high frequency ranges (30 GHz)", () => {
    // 30 GHz = 30,000,000,000 Hz
    const uhfHz = 30_000_000_000;
    expect(isValidFrequency(uhfHz)).toBe(true);
  });

  it("should invalidate frequencies above the 30 GHz limit", () => {
    const tooHighHz = 31_000_000_000;
    expect(isValidFrequency(tooHighHz)).toBe(false);
  });

  it("should handle string parsing with units accurately", () => {
    expect(parseFrequency("137.5MHz")).toBe(137_500_000);
    expect(parseFrequency("2.4GHz")).toBe(2_400_000_000);
    expect(parseFrequency("440Hz")).toBe(440);
    expect(parseFrequency("18kHz")).toBe(18_000);

    // Numeric separators
    expect(parseFrequency("137_500_000")).toBe(137_500_000);
    expect(parseFrequency("137_500_000Hz")).toBe(137_500_000);
  });

  it("should handle legacy defaults correctly", () => {
    // Default unit should be Hz now, but some parts might still use MHz as fallback
    expect(parseFrequency("137.5", "MHz")).toBe(137_500_000);
    expect(parseFrequency("440", "Hz")).toBe(440);
  });
});

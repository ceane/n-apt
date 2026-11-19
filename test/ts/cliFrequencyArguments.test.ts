import { resolveCliCenterFrequencyArgument } from "@n-apt/features/capture/policy";
import {
  parseCliFrequencyArgumentHz,
  validateCliArguments,
} from "../../scripts/cli/options";

describe("CLI frequency arguments", () => {
  it("uses a separated sole value as an absolute frequency", () => {
    expect(resolveCliCenterFrequencyArgument("300_000", 2_000_000_000)).toBe(
      300_000,
    );
  });

  it("resolves whole frequency arithmetic for capture tuning", () => {
    expect(
      resolveCliCenterFrequencyArgument("1_900_000-1_000_000", 2_000_000_000),
    ).toBe(900_000);
  });

  it("accepts frequency arithmetic for snapshot tuning", () => {
    expect(() =>
      validateCliArguments([
        "capture",
        "snapshot",
        "--frequency",
        "1_900_000-1_000_000",
      ]),
    ).not.toThrow();
  });

  it("accepts formatted frequencies and arithmetic for demod processing", () => {
    expect(() =>
      validateCliArguments([
        "demod",
        "--input",
        "capture.iq",
        "--center-frequency",
        "300_000",
        "--min-frequency",
        "1_900_000-1_000_000",
        "--max-frequency",
        "2_000_000+100_000",
      ]),
    ).not.toThrow();
  });

  it("parses separated values and arithmetic for demod processing", () => {
    expect(parseCliFrequencyArgumentHz("300_000")).toBe(300_000);
    expect(parseCliFrequencyArgumentHz("1_900_000-1_000_000")).toBe(900_000);
  });
});

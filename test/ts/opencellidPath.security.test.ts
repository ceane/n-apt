const { resolveSafeMccCsvPath } = require("../../scripts/shared/opencellidPath.cjs");

describe("resolveSafeMccCsvPath", () => {
  it("allows only known MCC values under the selected directory", () => {
    expect(resolveSafeMccCsvPath("/tmp/opencellid", 310)).toBe(
      "/tmp/opencellid/310.csv",
    );
    expect(() => resolveSafeMccCsvPath("/tmp/opencellid", "../../etc/passwd")).toThrow(
      /MCC/i,
    );
    expect(() => resolveSafeMccCsvPath("/tmp/opencellid", 999)).toThrow(/MCC/i);
  });
});

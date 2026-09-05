import { isValidNaptRange } from "@n-apt/math/signals";

describe("isValidNaptRange", () => {
  const configuredChannels = [
    { label: "A", min: 18_000, max: 4_470_000 },
    { label: "B", min: 24_100_000, max: 30_370_000 },
    { label: "C", min: 4_750_000, max: 23_000_000 },
  ];

  it("accepts ranges contained by a configured channel", () => {
    expect(
      isValidNaptRange({ min: 18_000, max: 4_470_000 }, configuredChannels),
    ).toBe(true);
  });

  it("rejects ranges outside the configured channels", () => {
    expect(
      isValidNaptRange({ min: 4_470_001, max: 4_700_000 }, configuredChannels),
    ).toBe(false);
  });
});

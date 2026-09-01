import {
  getRtlSdrOptionState,
  haveRtlSdrOptionsChanged,
} from "@n-apt/webusb/rtlSdrOptionState";

describe("standalone WebUSB option state", () => {
  const validInput = {
    centerFrequencyText: "1.6",
    centerFrequencyUnit: "MHz" as const,
    sampleRateText: "3.2",
    sampleRateUnit: "MHz" as const,
    fftSizeText: "32768",
    gainText: "49.6",
    ppmText: "1",
  };

  it("canonicalizes equivalent frequency denominations to the same device state", () => {
    const megahertz = getRtlSdrOptionState(validInput);
    const hertz = getRtlSdrOptionState({
      ...validInput,
      centerFrequencyText: "1600000",
      centerFrequencyUnit: "Hz",
      sampleRateText: "3200000",
      sampleRateUnit: "Hz",
    });

    expect(megahertz).toEqual(hertz);
    expect(haveRtlSdrOptionsChanged(megahertz, hertz)).toBe(false);
  });

  it.each([
    ["gainText", " "],
    ["ppmText", "invalid"],
    ["sampleRateText", "not-a-rate"],
  ] as const)("rejects an invalid %s without creating a fallback state", (field, value) => {
    expect(
      getRtlSdrOptionState({
        ...validInput,
        [field]: value,
      }),
    ).toBeNull();
  });

  it("does not treat whitespace around a value as a device change", () => {
    const original = getRtlSdrOptionState(validInput);
    const edited = getRtlSdrOptionState({
      ...validInput,
      centerFrequencyText: " 1.6 ",
      sampleRateText: " 3.2 ",
    });

    expect(haveRtlSdrOptionsChanged(original, edited)).toBe(false);
  });
});

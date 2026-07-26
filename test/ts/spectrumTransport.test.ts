import {
  createSpectrumTransport,
  type SpectrumTransportCommands,
} from "../../src/ts/hooks/useSpectrumTransport";

describe("spectrum transport command boundary", () => {
  test("exposes only transport commands", () => {
    const commands: SpectrumTransportCommands = {
      sendFrequencyRange: jest.fn(),
      sendPauseCommand: jest.fn(),
      sendPowerScaleCommand: jest.fn(),
    };

    const transport = createSpectrumTransport(commands);

    expect(transport).toEqual(commands);
    expect(Object.keys(transport).sort()).toEqual([
      "sendFrequencyRange",
      "sendPauseCommand",
      "sendPowerScaleCommand",
    ]);
  });
});

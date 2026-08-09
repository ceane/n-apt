import { readFileSync } from "node:fs";

describe("demod signal configuration", () => {
  it("reuses the maintained display and source settings sections", () => {
    const source = readFileSync(
      "src/ts/features/demodulation/react-flow/nodes/SignalConfigNode.tsx",
      "utf8",
    );

    expect(source).toContain('from "@n-apt/spectrum/public/SignalDisplaySection"');
    expect(source).toContain('from "@n-apt/spectrum/public/SourceSettingsSection"');
  });

  it("sends node sample-rate changes to the live SDR backend", () => {
    const source = readFileSync(
      "src/ts/features/demodulation/react-flow/nodes/SignalConfigNode.tsx",
      "utf8",
    );

    expect(source).toContain("onSettingsChange");
    expect(source).toContain("wsConnection.sendSettings");
  });

  it("keeps shared setting rows flush with the node background", () => {
    const source = readFileSync(
      "src/ts/features/demodulation/react-flow/nodes/SignalConfigNode.tsx",
      "utf8",
    );

    expect(source).toContain("& > div > div:not(:first-child)");
    expect(source).toContain("background: transparent");
    expect(source).toContain("border: none");
  });

  it("adds separation before the source settings section", () => {
    const source = readFileSync(
      "src/ts/features/demodulation/react-flow/nodes/SignalConfigNode.tsx",
      "utf8",
    );

    expect(source).toContain("& > div:nth-of-type(4) > div:first-child");
    expect(source).toContain("margin-top: 16px");
  });
});

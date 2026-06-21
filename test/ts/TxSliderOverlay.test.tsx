/**
 * @jest-environment jsdom
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import TxSliderOverlay from "@n-apt/components/TxSliderOverlay";

describe("TxSliderOverlay", () => {
  it("shows the tx sample rate, center frequency, and power from the current tx state", () => {
    render(
      <TestWrapper>
        <TxSliderOverlay
          signalLabel="APT"
          visibleMinHz={18_000}
          visibleMaxHz={4_390_000}
          txCenterHz={0}
          txSampleRateHz={120_000}
          powerDbm={-18}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByText(
        "120.0kHz sample rate · 60.0kHz center · -18.0 dBm target",
      ),
    ).toBeDefined();
    expect(screen.getByText("APT")).toBeDefined();
  });
});

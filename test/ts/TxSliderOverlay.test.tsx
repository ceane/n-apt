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
          txCenterHz={137_100_000}
          txSampleRateHz={2_400_000}
          powerDbm={-18}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByText(
        "2.400MHz sample rate · 137.100MHz center · -18.0 dBm target",
      ),
    ).toBeInTheDocument();
  });
});

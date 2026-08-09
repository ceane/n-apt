/**
 * @jest-environment jsdom
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import TxSliderOverlay from "@n-apt/transmit/TxSliderOverlay";

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
      screen.getByText("120.0kHz sample rate · 0Hz center · -18.0 dBm target"),
    ).toBeDefined();
    expect(screen.getByText("APT")).toBeDefined();
  });

  it("dynamically updates displayed sample rate and band width when props change", () => {
    const { container, rerender } = render(
      <TestWrapper>
        <TxSliderOverlay
          signalLabel="APT"
          visibleMinHz={0}
          visibleMaxHz={10_000_000}
          txCenterHz={5_000_000}
          txSampleRateHz={8_000_000}
        />
      </TestWrapper>,
    );

    expect(screen.getByText(/8\.000MHz sample rate/)).toBeInTheDocument();
    const track = container.querySelector('[role="slider"]');
    const bandFill = track?.firstElementChild as HTMLElement;
    expect(bandFill).toHaveStyle({ width: "80%" });

    rerender(
      <TestWrapper>
        <TxSliderOverlay
          signalLabel="APT"
          visibleMinHz={0}
          visibleMaxHz={10_000_000}
          txCenterHz={5_000_000}
          txSampleRateHz={2_000_000}
        />
      </TestWrapper>,
    );

    expect(screen.getByText(/2\.000MHz sample rate/)).toBeInTheDocument();
    expect(bandFill).toHaveStyle({ width: "20%" });
  });
});

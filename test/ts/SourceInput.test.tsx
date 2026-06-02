import React from "react";
import { render, screen, within } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import SourceInput from "../../src/ts/components/sidebar/SourceInput";

describe("SourceInput", () => {
  it("renders transmitting (Tx) for tx-capable devices that are active", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              txMode: true,
              status: {
                label: "transmitting",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="device-2"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("TX/RX · Transmitting (Tx)")).toBeInTheDocument();
    const deviceRow = screen
      .getByText("HackRF One #2")
      .closest('[role="button"]');
    expect(deviceRow).not.toBeNull();
    expect(
      within(deviceRow as HTMLElement).getByRole("button", { name: /pause/i }),
    ).toBeInTheDocument();
  });
});

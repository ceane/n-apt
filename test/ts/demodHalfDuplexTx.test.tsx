import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import SourceSidebar from "@n-apt/spectrum/sidebar/SourceSidebar";
import type { ComponentProps } from "react";

const hackrfDevice: ComponentProps<typeof SourceSidebar>["devices"] = [
  {
    id: "hackrf-1",
    name: "HackRF One",
    backend: "hackrf_one",
    capability: "tx_rx",
    duplex_mode: "Half-duplex",
    status: { label: "streaming", paused: false },
  },
];

describe("demod half-duplex Tx flow", () => {
  it("offers Preview Tx for a streaming half-duplex HackRF when preview is wired", () => {
    const onPreviewDeviceTx = jest.fn();
    render(
      <TestWrapper>
        <SourceSidebar
          sourceMode="live"
          devices={hackrfDevice}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
          onPreviewDeviceTx={onPreviewDeviceTx}
        />
      </TestWrapper>,
    );

    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(deviceRow).not.toBeNull();
    const previewButton = within(deviceRow).getByRole("button", {
      name: "Preview Tx",
    });
    expect(previewButton).toBeInTheDocument();
    expect(
      within(deviceRow).queryByRole("button", { name: "Start Tx" }),
    ).not.toBeInTheDocument();

    fireEvent.click(previewButton);
    expect(onPreviewDeviceTx).toHaveBeenCalledWith("hackrf-1");
  });

  it("switches to Start Tx once the half-duplex HackRF is paused in Tx standby", () => {
    const onToggleDeviceTxMode = jest.fn();
    const { rerender } = render(
      <TestWrapper>
        <SourceSidebar
          sourceMode="live"
          devices={hackrfDevice}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={onToggleDeviceTxMode}
          onPreviewDeviceTx={jest.fn()}
        />
      </TestWrapper>,
    );

    const rowBefore = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(
      within(rowBefore).getByRole("button", { name: "Preview Tx" }),
    ).toBeInTheDocument();

    // After the preview pauses Rx and binds the tx-suite role, the device
    // reports Tx standby and the pill offers Start Tx instead of Preview Tx.
    rerender(
      <TestWrapper>
        <SourceSidebar
          sourceMode="live"
          devices={[
            {
              ...hackrfDevice[0],
              active_duplex_mode: "tx",
              status: { label: "standby", paused: true },
            },
          ]}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={onToggleDeviceTxMode}
          onPreviewDeviceTx={jest.fn()}
          txBindingSourceId="hackrf-1"
          txPreviewSourceId="hackrf-1"
        />
      </TestWrapper>,
    );

    const rowAfter = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(
      within(rowAfter).getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
    expect(
      within(rowAfter).queryByRole("button", { name: "Preview Tx" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(rowAfter).getByRole("button", { name: "Start Tx" }),
    );
    expect(onToggleDeviceTxMode).toHaveBeenCalledWith("hackrf-1");
  });
});

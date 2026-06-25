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
              duplex_mode: "Half-duplex",
              status: {
                label: "transmitting",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="device-2"
          spaceBoundDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Rx/Tx · Connected · Half-duplex")).toBeInTheDocument();
    const deviceRow = screen
      .getByText("HackRF One #2")
      .closest('[role="button"]');
    expect(deviceRow).not.toBeNull();
    expect(
      within(deviceRow as HTMLElement).getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
  });

  it("prefers the transmitting device over the selected device for active styling", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "mock",
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: {
                label: "transmitting",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Rx/Tx · Connected · Half-duplex")).toBeInTheDocument();
    expect(screen.getByText("Mock APT SDR")).toBeInTheDocument();
  });

  it("renders all sources when the source section is not sticky", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "tx_rx",
              duplex_mode: "Simplex",
              status: {
                label: "streaming",
                actionLabel: "Pause",
                actionTitle: "Pause device",
                onAction: jest.fn(),
              },
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "disconnected" },
            },
          ]}
          selectedDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Mock APT SDR")).toBeInTheDocument();
    expect(screen.getByText("HackRF One #2")).toBeInTheDocument();
    expect(screen.getByText("File Selection")).toBeInTheDocument();
  });

  it("reduces sticky live source mode to the selected source row", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          compactActiveOnly
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "tx_rx",
              duplex_mode: "Simplex",
              status: {
                label: "streaming",
                actionLabel: "Pause",
                actionTitle: "Pause device",
                onAction: jest.fn(),
              },
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              status: { label: "disconnected" },
            },
          ]}
          selectedDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByTitle("Switch to Mock APT SDR")).toBeInTheDocument();
    expect(
      screen.queryByTitle("Switch to HackRF One #2"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("File Selection")).not.toBeInTheDocument();
  });

  it("keeps the transmitting source as the sticky priority row", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          compactActiveOnly
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "tx_rx",
              status: {
                label: "streaming",
                actionLabel: "Pause",
                actionTitle: "Pause device",
                onAction: jest.fn(),
              },
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: {
                label: "transmitting",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.queryByTitle("Switch to Mock APT SDR"),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle("Switch to HackRF One #2")).toBeInTheDocument();
    expect(screen.queryByText("File Selection")).not.toBeInTheDocument();
    expect(screen.getByText("Rx/Tx · Connected · Half-duplex")).toBeInTheDocument();
  });

  it("keeps live and transmit actions available when transmit is active", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "mock",
              duplex_mode: "Simplex",
              status: {
                label: "streaming",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: {
                label: "transmitting",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    const mockRow = screen
      .getByText("Mock APT SDR")
      .closest('[role="button"]') as HTMLElement;
    expect(mockRow).not.toBeNull();
    expect(
      within(mockRow).getByRole("button", { name: /pause/i }),
    ).toBeInTheDocument();
    const txRow = screen
      .getByText("HackRF One #2")
      .closest('[role="button"]') as HTMLElement;
    expect(txRow).not.toBeNull();
    expect(
      within(txRow).getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
  });

  it("shows the space hint on the onscreen active device when the selected device is disconnected", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "rx",
              status: {
                label: "streaming",
                actionLabel: "Pause",
                actionTitle: "Pause device",
                onAction: jest.fn(),
              },
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              status: {
                label: "disconnected",
                actionLabel: "Resume",
                actionTitle: "Resume transmit mode",
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

    const activeRow = screen
      .getByText("Mock APT SDR")
      .closest('[role="button"]');
    expect(activeRow).not.toBeNull();
    expect(
      within(activeRow as HTMLElement).getByText("[Space]"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("HackRF One #2").closest('[role="button"]'),
    ).not.toBeNull();
  });

  it("reduces sticky file mode to the file selection row", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          compactActiveOnly
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "device-1",
              name: "Mock APT SDR",
              capability: "mock",
              duplex_mode: "Simplex",
              status: { label: "streaming" },
            },
            {
              id: "device-2",
              name: "HackRF One #2",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "disconnected" },
            },
          ]}
          selectedDeviceId="device-1"
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.queryByTitle("Switch to Mock APT SDR"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTitle("Switch to HackRF One #2"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("File Selection")).toBeInTheDocument();
  });

  it("labels idle tx-capable device actions as Start Tx", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              capability: "tx",
              duplex_mode: "Simplex",
              status: {
                label: "connected",
                actionLabel: "Start Tx",
                actionTitle: "Start transmit mode",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="mock-tx"
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const txRow = screen
      .getByText("Mock Tx SDR")
      .closest('[role="button"]') as HTMLElement;
    expect(txRow).not.toBeNull();
    expect(
      within(txRow).getByRole("button", { name: /start tx/i }),
    ).toBeInTheDocument();
  });

  it("shows half-duplex stats and separate Rx/Tx controls for HackRF-style devices", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: {
                label: "connected",
                paused: false,
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Rx/Tx · Connected · Half-duplex")).toBeInTheDocument();
    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(deviceRow).not.toBeNull();
    expect(within(deviceRow).getByRole("button", { name: /resume rx/i })).toBeInTheDocument();
    expect(
      within(deviceRow).getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
  });
});

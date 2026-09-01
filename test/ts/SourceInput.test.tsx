import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import SourceInput from "@n-apt/spectrum/sidebar/SourceInput";
import SourceSidebar from "@n-apt/spectrum/sidebar/SourceSidebar";
import { isSourceDeviceSelected } from "@n-apt/spectrum/sidebar/SourceInput";

jest.mock("@n-apt/ui/VaultStatus", () => ({
  VaultStatus: ({ compact }: { compact?: boolean }) =>
    compact ? <span>VAULT LOCKED</span> : null,
}));

describe("source selection state", () => {
  it("does not select a live device while file mode is active", () => {
    expect(isSourceDeviceSelected("file", "mock-rx", "mock-rx")).toBe(false);
    expect(isSourceDeviceSelected("live", "mock-rx", "mock-rx")).toBe(true);
  });
});

describe("SourceInput", () => {
  it("shows vault status in the file selection pill and hides it while files load", () => {
    const { rerender } = render(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          selectedFilesCount={1}
          fileActionLabel="Pause"
          onSourceModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("VAULT LOCKED")).toBeInTheDocument();
    const secondaryRow = screen.getByText("Browse...").parentElement;
    expect(secondaryRow).toHaveStyle({ display: "flex", gap: "8px" });

    rerender(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          selectedFilesCount={1}
          fileActionLabel="Process [auto]"
          onSourceModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.queryByText("VAULT LOCKED")).not.toBeInTheDocument();
    expect(screen.getByText("Browse...")).toBeInTheDocument();
  });

  it("offers a HackRF Rx preview action in the compact source pill", () => {
    const onPreviewDeviceTx = jest.fn();
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          compactActiveOnly
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "streaming" },
            },
          ]}
          onPreviewDeviceTx={onPreviewDeviceTx}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview Tx" }));

    expect(onPreviewDeviceTx).toHaveBeenCalledWith("hackrf-1");
  });

  it("recognizes HackRF records that only identify the hardware by name", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          compactActiveOnly
          onSourceModeChange={jest.fn()}
          selectedDeviceId="radio-1"
          devices={[
            {
              id: "radio-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "streaming" },
            },
          ]}
          onPreviewDeviceTx={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Preview Tx" }),
    ).toBeInTheDocument();
  });

  it("shows Tx standby as active after Rx is paused for preview", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "standby", paused: true },
            },
          ]}
          onPreviewDeviceTx={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Standby/)).toBeInTheDocument();
    const rxButton = screen.getByRole("button", { name: "Resume Rx [Space]" });
    expect(rxButton).toHaveStyle({ opacity: "0.45" });
  });

  it("transforms buttons to Resume Rx (muted) and Start Tx when txPreviewSourceId is set", () => {
    const { rerender } = render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "streaming", paused: false },
            },
          ]}
          onPreviewDeviceTx={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
          txPreviewSourceId={null}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Preview Tx" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pause Rx [Space]" }),
    ).toBeInTheDocument();

    rerender(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "standby", paused: true },
            },
          ]}
          onPreviewDeviceTx={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
          txPreviewSourceId="hackrf-1"
          txBindingSourceId="hackrf-1"
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
    const mutedRxButton = screen.getByRole("button", {
      name: "Resume Rx [Space]",
    });
    expect(mutedRxButton).toBeInTheDocument();
    expect(mutedRxButton).toHaveStyle({ opacity: "0.45" });
  });

  it("keeps the Sources button on Resume Rx when a streaming source is frozen", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "streaming", paused: true },
            },
          ]}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Resume Rx [Space]" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pause Rx [Space]" }),
    ).not.toBeInTheDocument();
  });

  it("labels backend Tx standby separately from paused Rx", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              active_duplex_mode: "tx",
              status: {
                label: "standby",
                paused: true,
              },
            },
          ]}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
          onPreviewDeviceTx={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resume Rx [Space]" }),
    ).toHaveStyle({ opacity: "0.45" });
  });

  it("supports capped multi-source selection without switching the active source", () => {
    const onSelectedDevicesChange = jest.fn();
    const rendered = render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectionMode="multi"
          maxSelectedDevices={2}
          selectedDeviceIds={["mock-rx"]}
          onSelectedDevicesChange={onSelectedDevicesChange}
          devices={[
            {
              id: "mock-rx",
              name: "Mock APT SDR",
              capability: "rx",
              status: { label: "connected" },
            },
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              capability: "tx",
              status: { label: "connected" },
            },
            {
              id: "extra-rx",
              name: "Mock Extra Rx SDR",
              capability: "rx",
              status: { label: "connected" },
            },
          ]}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Mock Tx SDR"));
    expect(onSelectedDevicesChange).toHaveBeenCalledWith([
      "mock-rx",
      "mock-tx",
    ]);

    rendered.rerender(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectionMode="multi"
          maxSelectedDevices={2}
          selectedDeviceIds={["mock-rx", "mock-tx"]}
          onSelectedDevicesChange={onSelectedDevicesChange}
          devices={[
            {
              id: "mock-rx",
              name: "Mock APT SDR",
              capability: "rx",
              status: { label: "connected" },
            },
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              capability: "tx",
              status: { label: "connected" },
            },
            {
              id: "extra-rx",
              name: "Mock Extra Rx SDR",
              capability: "rx",
              status: { label: "connected" },
            },
          ]}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Mock Extra Rx SDR"));
    expect(onSelectedDevicesChange).toHaveBeenLastCalledWith([
      "mock-tx",
      "extra-rx",
    ]);
  });

  it("keeps Rx available while hiding Tx in the demod source sidebar", () => {
    const onToggleDeviceRxPause = jest.fn();
    render(
      <TestWrapper>
        <SourceSidebar
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "connected", paused: false },
            },
          ]}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={onToggleDeviceRxPause}
        />
      </TestWrapper>,
    );

    const deviceRow = screen.getByText("HackRF One").closest('[role="button"]');
    expect(deviceRow).not.toBeNull();
    expect(
      within(deviceRow as HTMLElement).getByRole("button", {
        name: /pause rx/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start tx|stop tx/i }),
    ).not.toBeInTheDocument();
  });

  it("shows receive playback controls and Tx-only sources in demod", () => {
    const onStartTx = jest.fn();
    render(
      <TestWrapper>
        <SourceSidebar
          devices={[
            {
              id: "mock-rx",
              name: "Mock APT SDR",
              capability: "rx",
              status: {
                label: "streaming",
                actionLabel: "Pause",
                onAction: jest.fn(),
              },
            },
            {
              id: "mock-tx",
              name: "Mock Tx SDR",
              capability: "tx",
              status: {
                label: "connected",
                actionLabel: "Start Tx",
                onAction: onStartTx,
              },
            },
          ]}
          selectedDeviceId="mock-rx"
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const rxRow = screen.getByText("Mock APT SDR").closest('[role="button"]');
    expect(rxRow).not.toBeNull();
    expect(
      within(rxRow as HTMLElement).getByRole("button", { name: /pause/i }),
    ).toBeInTheDocument();
    const txRow = screen.getByText("Mock Tx SDR").closest('[role="button"]');
    expect(txRow).not.toBeNull();
    fireEvent.click(
      within(txRow as HTMLElement).getByRole("button", { name: "Start Tx" }),
    );
    expect(onStartTx).toHaveBeenCalledTimes(1);
  });

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

    expect(
      screen.getByText("Rx/Tx · Transmitting (Tx) · Half-duplex"),
    ).toBeInTheDocument();
    const deviceRow = screen
      .getByText("HackRF One #2")
      .closest('[role="button"]');
    expect(deviceRow).not.toBeNull();
    expect(
      within(deviceRow as HTMLElement).getByRole("button", { name: "Stop Tx" }),
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

    expect(
      screen.getByText("Rx/Tx · Transmitting (Tx) · Half-duplex"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mock APT SDR")).not.toBeInTheDocument();
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

  it("hides the mock APT fallback when a real hardware source is available", () => {
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
              status: { label: "connected" },
            },
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              backend: "mock_apt",
              capability: "mock",
              duplex_mode: "Simplex",
              status: { label: "connected" },
            },
          ]}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("HackRF One")).toBeInTheDocument();
    expect(screen.queryByText("Mock APT SDR")).not.toBeInTheDocument();
    expect(
      screen.getByText("Rx/Tx · Connected · Half-duplex"),
    ).toBeInTheDocument();
  });

  it("drops a selected mock source from the list once hardware is available", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              backend: "mock_apt",
              capability: "mock",
              // Idle mock: not the active fallback, so it drops once a
              // connected hardware peer is available.
              status: { label: "connected" },
            },
            {
              id: "rtl-1",
              name: "RTL-SDR v4",
              backend: "rtl-sdr",
              capability: "rx",
              status: { label: "connected" },
            },
          ]}
          selectedDeviceId="mock-apt"
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.queryByText("Mock APT SDR")).not.toBeInTheDocument();
    expect(screen.getByText("RTL-SDR v4")).toBeInTheDocument();
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
    expect(
      screen.getByText("Rx/Tx · Transmitting (Tx) · Half-duplex"),
    ).toBeInTheDocument();
  });

  it("drops mock receive actions when hardware transmit is active", () => {
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

    expect(screen.queryByText("Mock APT SDR")).not.toBeInTheDocument();
    const txRow = screen
      .getByText("HackRF One #2")
      .closest('[role="button"]') as HTMLElement;
    expect(txRow).not.toBeNull();
    expect(
      within(txRow).getByRole("button", { name: "Stop Tx" }),
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
    const onAction = jest.fn();
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
                onAction,
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
    expect(within(txRow).getByText("[Space]")).toBeInTheDocument();

    fireEvent.keyUp(within(txRow).getByRole("button", { name: /start tx/i }), {
      key: " ",
      code: "Space",
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("labels a simplex Mock Tx device as Start Tx even when preview is available", () => {
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
              status: { label: "connected", onAction: jest.fn() },
            },
          ]}
          selectedDeviceId="mock-tx"
          onPreviewDeviceTx={jest.fn()}
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const txRow = screen
      .getByText("Mock Tx SDR")
      .closest('[role="button"]') as HTMLElement;
    expect(
      within(txRow).getByRole("button", { name: /start tx/i }),
    ).toBeInTheDocument();
    expect(
      within(txRow).queryByRole("button", { name: /preview tx/i }),
    ).not.toBeInTheDocument();
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

    expect(
      screen.getByText("Rx/Tx · Connected · Half-duplex"),
    ).toBeInTheDocument();
    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(deviceRow).not.toBeNull();
    const rxButton = within(deviceRow).getByRole("button", {
      name: /pause rx/i,
    });
    expect(rxButton).toBeInTheDocument();
    expect(within(rxButton).getByText("[Space]")).toBeInTheDocument();
    expect(
      within(deviceRow).getByRole("button", { name: "Start Tx" }),
    ).toBeInTheDocument();
    expect(
      within(deviceRow).queryByText("start/stop transmit mode"),
    ).not.toBeInTheDocument();
  });

  it("shows a button-sized spinner instead of Rx controls while a half-duplex device loads", () => {
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
                label: "loading",
                loading: true,
                loadingLabel: "Rx active · waiting for first frame…",
                paused: false,
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

    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    // While loading, a spinner occupies the action slot instead of any
    // Resume/Pause control; Tx mode stays available for half-duplex devices.
    expect(
      within(deviceRow).getByRole("status", {
        name: /rx active · waiting for first frame/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(deviceRow).queryByRole("button", {
        name: /pause rx|resume rx|loading/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(deviceRow).getByRole("button", { name: /start tx/i }),
    ).toBeInTheDocument();
  });

  it("shows a spinner instead of a Resume action while a non-half-duplex device loads", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "rtl-1",
              name: "RTL-SDR v4",
              backend: "rtl-sdr",
              capability: "rx",
              duplex_mode: "Simplex",
              status: {
                label: "loading",
                loading: true,
                loadingLabel: "Loading RTL-SDR v4…",
                paused: false,
                actionLabel: "Resume",
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="rtl-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
        />
      </TestWrapper>,
    );

    const deviceRow = screen
      .getByText("RTL-SDR v4")
      .closest('[role="button"]') as HTMLElement;
    expect(
      within(deviceRow).getByRole("status", { name: /loading/i }),
    ).toBeInTheDocument();
    expect(
      within(deviceRow).queryByRole("button", { name: /resume/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a Restart action on a stale pill and invokes it without changing selection", () => {
    const onRestart = jest.fn();
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "mock-rx",
              name: "Mock APT SDR",
              capability: "rx",
              status: { label: "streaming" },
            },
            {
              id: "rtl-1",
              name: "RTL-SDR v4",
              backend: "rtl-sdr",
              capability: "rx",
              status: {
                label: "stale",
                canRestart: true,
                onRestart: onRestart,
              },
            },
          ]}
          selectedDeviceId="mock-rx"
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const staleRow = screen
      .getByText("RTL-SDR v4")
      .closest('[role="button"]') as HTMLElement;
    const restartButton = within(staleRow).getByRole("button", {
      name: /restart/i,
    });
    expect(restartButton).toBeEnabled();

    fireEvent.click(restartButton);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("renders Restarting… as a disabled button while the restart is in flight", () => {
    const onRestart = jest.fn();
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="hackrf-1"
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "rx",
              status: {
                label: "stale",
                canRestart: true,
                restarting: true,
                onRestart: onRestart,
              },
            },
          ]}
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const restartingButton = screen.getByRole("button", {
      name: "Restarting device",
    }) as HTMLButtonElement;
    expect(restartingButton).toBeDisabled();

    fireEvent.click(restartingButton);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("labels the loading spinner as Restarting… while a per-source restart is pending", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="rtl-1"
          devices={[
            {
              id: "rtl-1",
              name: "RTL-SDR v4",
              backend: "rtl-sdr",
              capability: "rx",
              status: {
                label: "loading",
                loading: true,
                restarting: true,
                loadingLabel: "Loading RTL-SDR v4…",
              },
            },
          ]}
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const deviceRow = screen
      .getByText("RTL-SDR v4")
      .closest('[role="button"]') as HTMLElement;
    expect(within(deviceRow).getByText("Restarting…")).toBeInTheDocument();
    expect(
      within(deviceRow).queryByRole("button", { name: /resume|pause/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the mock fallback pill visible while it is the streaming active source", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "mock-apt",
              name: "Mock APT SDR",
              backend: "mock_apt",
              capability: "mock",
              status: { label: "streaming" },
            },
            {
              id: "rtl-1",
              name: "RTL-SDR v4",
              backend: "rtl-sdr",
              capability: "rx",
              status: { label: "stale" },
            },
          ]}
          selectedDeviceId="mock-apt"
          onSelectedDeviceChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Mock APT SDR")).toBeInTheDocument();
  });

  it("switches half-duplex devices into Tx standby with one click", () => {
    const onToggleDeviceTxMode = jest.fn();
    const onPreviewDeviceTx = jest.fn();
    const { rerender } = render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: {
                label: "streaming",
                paused: false,
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="hackrf-1"
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={onToggleDeviceTxMode}
          onPreviewDeviceTx={onPreviewDeviceTx}
        />
      </TestWrapper>,
    );

    const initialRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    fireEvent.click(
      within(initialRow).getByRole("button", { name: "Preview Tx" }),
    );
    expect(onPreviewDeviceTx).toHaveBeenCalledWith("hackrf-1");

    rerender(
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
                label: "standby",
                paused: true,
                onAction: jest.fn(),
              },
            },
          ]}
          selectedDeviceId="hackrf-1"
          onSelectedDeviceChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={onToggleDeviceTxMode}
        />
      </TestWrapper>,
    );

    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(deviceRow).not.toBeNull();

    const txButton = within(deviceRow).getByRole("button", {
      name: "Start Tx",
    });
    const rxButton = within(deviceRow).getByRole("button", {
      name: /resume rx/i,
    });

    expect(txButton).toHaveStyle({ opacity: "1" });
    expect(rxButton).toHaveStyle({ opacity: "0.45" });

    fireEvent.click(txButton);
    expect(onToggleDeviceTxMode).toHaveBeenCalledTimes(1);
  });

  it("auto-opens the browse dialog once when autoBrowseRequested is set in file mode", () => {
    const clickSpy = jest
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const onAutoBrowseHandled = jest.fn();

    const { rerender } = render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          autoBrowseRequested
          onAutoBrowseHandled={onAutoBrowseHandled}
          onSourceModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    // Not in file mode yet: no click.
    expect(clickSpy).not.toHaveBeenCalled();

    rerender(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          autoBrowseRequested
          onAutoBrowseHandled={onAutoBrowseHandled}
          onSourceModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(onAutoBrowseHandled).toHaveBeenCalledTimes(1);

    // After the parent clears the request, no further clicks.
    rerender(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          autoBrowseRequested={false}
          onAutoBrowseHandled={onAutoBrowseHandled}
          onSourceModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it("disables source action buttons while the pills are dimmed in file mode", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          livePreviewStage={0}
          onSourceModeChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "streaming", paused: false },
            },
          ]}
        />
      </TestWrapper>,
    );

    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    expect(deviceRow).not.toBeNull();

    const pauseRx = within(deviceRow).getByRole("button", {
      name: /pause rx/i,
    });
    const startTx = within(deviceRow).getByRole("button", {
      name: "Start Tx",
    });
    expect(pauseRx).toBeDisabled();
    expect(startTx).toBeDisabled();
  });

  it("enables source action buttons at full transparency outside file mode", () => {
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          onToggleDeviceRxPause={jest.fn()}
          onToggleDeviceTxMode={jest.fn()}
          devices={[
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "streaming", paused: false },
            },
          ]}
        />
      </TestWrapper>,
    );

    const deviceRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    const pauseRx = within(deviceRow).getByRole("button", {
      name: /pause rx/i,
    });
    const startTx = within(deviceRow).getByRole("button", {
      name: "Start Tx",
    });
    expect(pauseRx).toBeEnabled();
    expect(startTx).toBeEnabled();
  });

  it("requires a double-click on a dimmed source pill to switch out of file mode", () => {
    const onSelectedDeviceChange = jest.fn();
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="file"
          livePreviewStage={0}
          onSourceModeChange={jest.fn()}
          selectedDeviceId="mock-rx"
          onSelectedDeviceChange={onSelectedDeviceChange}
          devices={[
            {
              id: "mock-rx",
              name: "Mock APT SDR",
              capability: "rx",
              status: { label: "connected" },
            },
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "connected", paused: false },
            },
          ]}
        />
      </TestWrapper>,
    );

    const targetRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;

    // A single click on the dimmed pill must not switch sources.
    fireEvent.click(targetRow);
    expect(onSelectedDeviceChange).not.toHaveBeenCalled();

    // A second click within the double-click window switches.
    fireEvent.click(targetRow);
    expect(onSelectedDeviceChange).toHaveBeenCalledWith("hackrf-1");
  });

  it("switches sources with a single click at full transparency outside file mode", () => {
    const onSelectedDeviceChange = jest.fn();
    render(
      <TestWrapper>
        <SourceInput
          sourceMode="live"
          onSourceModeChange={jest.fn()}
          selectedDeviceId="mock-rx"
          onSelectedDeviceChange={onSelectedDeviceChange}
          devices={[
            {
              id: "mock-rx",
              name: "Mock APT SDR",
              capability: "rx",
              status: { label: "connected" },
            },
            {
              id: "hackrf-1",
              name: "HackRF One",
              backend: "hackrf_one",
              capability: "tx_rx",
              duplex_mode: "Half-duplex",
              status: { label: "connected", paused: false },
            },
          ]}
        />
      </TestWrapper>,
    );

    const targetRow = screen
      .getByText("HackRF One")
      .closest('[role="button"]') as HTMLElement;
    fireEvent.click(targetRow);
    expect(onSelectedDeviceChange).toHaveBeenCalledWith("hackrf-1");
  });
});

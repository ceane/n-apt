import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import SourceInput from "../../src/ts/components/sidebar/SourceInput";
import SourceSidebar from "../../src/ts/components/sidebar/SourceSidebar";
import { isSourceDeviceSelected } from "../../src/ts/components/sidebar/SourceInput";

jest.mock("../../src/ts/components/ui/VaultStatus", () => ({
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
              status: { label: "tx_preview", paused: true },
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
    const rxButton = screen.getByRole("button", { name: "Resume Rx [Space]" });
    expect(rxButton).toHaveStyle({ opacity: "0.45" });
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

    expect(screen.getByRole("button", { name: "Start Tx" })).toBeInTheDocument();
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
      screen.getByText("Rx/Tx · Connected · Half-duplex"),
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
      screen.getByText("Rx/Tx · Connected · Half-duplex"),
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
              status: { label: "streaming" },
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
      screen.getByText("Rx/Tx · Connected · Half-duplex"),
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

  it("shows a loading spinner instead of an assumed Rx pause action", () => {
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
    expect(
      within(deviceRow).getByRole("status", { name: /rx active.*first frame/i }),
    ).toBeInTheDocument();
    expect(
      within(deviceRow).queryByRole("button", { name: /pause rx/i }),
    ).not.toBeInTheDocument();
    expect(
      within(deviceRow).queryByRole("button", { name: /start tx/i }),
    ).not.toBeInTheDocument();
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
                label: "tx_preview",
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

    const txButton = within(deviceRow).getByRole("button", { name: "Start Tx" });
    const rxButton = within(deviceRow).getByRole("button", {
      name: /resume rx/i,
    });

    expect(txButton).toHaveStyle({ opacity: "1" });
    expect(rxButton).toHaveStyle({ opacity: "0.45" });

    fireEvent.click(txButton);
    expect(onToggleDeviceTxMode).toHaveBeenCalledTimes(1);
  });
});

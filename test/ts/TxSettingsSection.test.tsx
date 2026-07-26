/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TestWrapper } from "./testUtils";
import { TxSettingsSection } from "../../src/ts/components/sidebar/TxSettingsSection";

describe("TxSettingsSection", () => {
  const defaultProps = {
    signal: "apt",
    bandwidthHz: 2_400_000,
    sampleRateHz: 5_200_000,
    maxSampleRateHz: 20_000_000,
    centerFrequencyHz: 137_100_000,
    ifftSize: 2048,
    ifftSizeOptions: [2048, 4096, 8192],
    powerDbm: -18,
    vgaGainDb: 16,
    ampEnabled: false,
    onSignalChange: jest.fn(),
    onSampleRateChange: jest.fn(),
    onCenterFrequencyChange: jest.fn(),
    onIfftSizeChange: jest.fn(),
    onPowerDbmChange: jest.fn(),
    onVgaGainChange: jest.fn(),
    onAmpEnabledChange: jest.fn(),
    isTransmitting: false,
    onToggleTransmit: jest.fn(),
    safetyEnabled: false,
    onSafetyEnabledChange: jest.fn(),
    safetyLimit: "room" as const,
    onSafetyLimitChange: jest.fn(),
    hopEnabled: true, // Enable hop to show hop rate
    onHopEnabledChange: jest.fn(),
    hopType: "range" as const,
    onHopTypeChange: jest.fn(),
    hopStartFrequencyHz: 10_000_000,
    onHopStartFrequencyHzChange: jest.fn(),
    hopEndFrequencyHz: 20_000_000,
    onHopEndFrequencyHzChange: jest.fn(),
    hopChannels: [],
    onHopChannelsChange: jest.fn(),
    hopRateHz: 10,
    onHopRateHzChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles ArrowUp and ArrowDown keys for Power, VGA gain, and Hop rate", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} />
      </TestWrapper>,
    );

    // 1. Test Power input arrow keys
    const powerInput = screen.getByDisplayValue("-18");
    fireEvent.keyDown(powerInput, { key: "ArrowUp" });
    expect(defaultProps.onPowerDbmChange).toHaveBeenLastCalledWith(-17);
    fireEvent.keyDown(powerInput, { key: "ArrowDown" });
    expect(defaultProps.onPowerDbmChange).toHaveBeenLastCalledWith(-18);

    // 2. Test VGA Gain input arrow keys
    const vgaInput = screen.getByDisplayValue("16");
    fireEvent.keyDown(vgaInput, { key: "ArrowUp" });
    expect(defaultProps.onVgaGainChange).toHaveBeenLastCalledWith(17);
    fireEvent.keyDown(vgaInput, { key: "ArrowDown" });
    expect(defaultProps.onVgaGainChange).toHaveBeenLastCalledWith(16);

    // 3. Test Hop rate input arrow keys
    const hopRateLabel = screen.getByText("Hop rate");
    const hopRateRow = hopRateLabel.closest("div")!;
    const hopRateInput = within(hopRateRow).getByRole("textbox");
    fireEvent.keyDown(hopRateInput, { key: "ArrowUp" });
    expect(defaultProps.onHopRateHzChange).toHaveBeenLastCalledWith(11);
    fireEvent.keyDown(hopRateInput, { key: "ArrowDown" });
    expect(defaultProps.onHopRateHzChange).toHaveBeenLastCalledWith(10);
  });

  it("shows the Rx sample rate above hop rate", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} />
      </TestWrapper>,
    );

    expect(screen.getAllByText("Rx Sample Rate").length).toBeGreaterThan(0);
    expect(screen.getByText(/5\.2\s*MHz/)).toBeInTheDocument();
    expect(screen.getByText("Hop rate")).toBeInTheDocument();
  });

  it("updates the Rx sample rate when the parent sample-rate state changes", () => {
    const { rerender } = render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} rxSampleRateHz={5_200_000} />
      </TestWrapper>,
    );

    expect(screen.getByText(/5\.2\s*MHz/)).toBeInTheDocument();

    rerender(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} rxSampleRateHz={2_400_000} />
      </TestWrapper>,
    );

    expect(screen.getByText(/2\.4\s*MHz/)).toBeInTheDocument();
    expect(screen.queryByText(/5\.2\s*MHz/)).not.toBeInTheDocument();
  });

  it("labels the Tx I/Q width as Tx Bandwidth", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} hopEnabled={false} />
      </TestWrapper>,
    );

    expect(screen.getAllByText("Tx Bandwidth").length).toBeGreaterThan(0);
  });

  it("disables hop rate when the Tx bandwidth fills the Rx sample rate", () => {
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          hopStartFrequencyHz={0}
          hopEndFrequencyHz={5_200_000}
        />
      </TestWrapper>,
    );

    const hopRateLabel = screen.getByText("Hop rate");
    const hopRateRow = hopRateLabel.closest("div")!;
    const hopRateInput = within(hopRateRow).getByRole("textbox");
    expect(hopRateInput).toBeDisabled();
  });

  it("disables hop rate when hopping channels with only one selected channel", () => {
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          hopType="channels"
          hopChannels={["a"]}
        />
      </TestWrapper>,
    );

    const hopRateLabel = screen.getByText("Hop rate");
    const hopRateRow = hopRateLabel.closest("div")!;
    const hopRateInput = within(hopRateRow).getByRole("textbox");
    expect(hopRateInput).toBeDisabled();
  });

  it("automatically enables hopping for multiple channels", () => {
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          hopEnabled={false}
          hopType="channels"
          hopChannels={["a", "b"]}
        />
      </TestWrapper>,
    );

    expect(screen.getAllByText("Range").length).toBeGreaterThan(0);
    expect(screen.getByText("Hop rate")).toBeInTheDocument();
    const hopRate = within(screen.getByText("Hop rate").closest("div")!).getByRole("textbox");
    expect(hopRate).toBeEnabled();
  });

  it("automatically enables hopping when bandwidth exceeds the Rx sample rate", () => {
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          hopEnabled={false}
          bandwidthHz={6_000_000}
          rxSampleRateHz={5_200_000}
        />
      </TestWrapper>,
    );

    expect(screen.getAllByText("Range").length).toBeGreaterThan(0);
    const hopRate = within(screen.getByText("Hop rate").closest("div")!).getByRole("textbox");
    expect(hopRate).toBeEnabled();
  });

  it("keeps Range visible while exposing Hop as a nested option", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} hopEnabled={false} />
      </TestWrapper>,
    );

    expect(screen.getAllByText("Range").length).toBeGreaterThan(0);
    expect(screen.getByText("Hop")).toBeInTheDocument();
    expect(screen.getByText("Range type")).toBeInTheDocument();
    expect(screen.getAllByText("Tx Bandwidth").length).toBeGreaterThan(0);
    expect(screen.queryByText("Center frequency")).toBeInTheDocument();
    expect(screen.queryByText("Tx I/Q range.")).toBeInTheDocument();
  });

  it("labels the transmit button as Stop Tx while transmitting", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} isTransmitting />
      </TestWrapper>,
    );

    expect(
      screen.getByRole("button", { name: /stop tx/i }),
    ).toBeInTheDocument();
  });

  it("warns when requested power is below the quantized IQ floor", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} powerDbm={-70} ifftSize={2048} />
      </TestWrapper>,
    );

    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent(/IQ floor/i);
    expect(warning).toHaveTextContent(/-45\.3 dBm/);
    expect(warning).toHaveTextContent(/increase FFT size/i);
    expect(warning).toHaveTextContent(/1,048,576/);
  });

  it("keeps the IQ floor warning visible at the rounded enforcement floor", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} powerDbm={-45} ifftSize={2048} />
      </TestWrapper>,
    );

    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent(/IQ floor/i);
    expect(warning).toHaveTextContent(/-45\.3 dBm/);
    expect(warning).toHaveTextContent(/stepped up to -45 dBm/);
  });

  it("guards Tx IFFT options against very coarse sample-rate bin widths", () => {
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          sampleRateHz={20_000_000}
          bandwidthHz={20_000_000}
          ifftSize={512}
          ifftSizeOptions={[512, 1024, 2048, 4096]}
        />
      </TestWrapper>,
    );

    const label = screen.getByText("IFFT Size");
    const row = label.closest("div")?.parentElement;
    expect(row).toBeTruthy();
    const select = within(row as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "2048",
      "4096",
    ]);
    expect(defaultProps.onIfftSizeChange).toHaveBeenCalledWith(2048);
    expect(screen.getByRole("status")).toHaveTextContent(/bin width/i);
  });

  it("offers a Tx IFFT size control using FFT-size options", () => {
    render(
      <TestWrapper>
        <TxSettingsSection {...defaultProps} />
      </TestWrapper>,
    );

    const label = screen.getByText("IFFT Size");
    const row = label.closest("div")?.parentElement;
    expect(row).toBeTruthy();
    const select = within(row as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "2048",
      "4096",
      "8192",
    ]);

    fireEvent.change(select, { target: { value: "4096" } });
    expect(defaultProps.onIfftSizeChange).toHaveBeenCalledWith(4096);
  });

  it("automatically selects the first channel and updates bandwidth when range type changes to channels", () => {
    const onBandwidthChange = jest.fn();
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          hopType="range"
          onBandwidthChange={onBandwidthChange}
        />
      </TestWrapper>,
    );

    const rangeTypeLabel = screen.getByText("Range type");
    const rangeTypeRow = rangeTypeLabel.closest("div")?.parentElement;
    const select = within(rangeTypeRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "channels" } });

    expect(defaultProps.onHopTypeChange).toHaveBeenCalledWith("channels");
    expect(defaultProps.onHopChannelsChange).toHaveBeenCalledWith(["a"]);
    // Channel A min: 18_000, max: 4_390_000 -> bw: 4_372_000, center: 2_204_000
    expect(onBandwidthChange).toHaveBeenCalledWith(4_372_000);
    expect(defaultProps.onCenterFrequencyChange).toHaveBeenCalledWith(2_204_000);
  });

  it("dispatches primary channel parameters when multiple channels are selected", () => {
    const onBandwidthChange = jest.fn();
    const onCenterFrequencyChange = jest.fn();
    render(
      <TestWrapper>
        <TxSettingsSection
          {...defaultProps}
          hopType="channels"
          hopChannels={["a"]}
          onBandwidthChange={onBandwidthChange}
          onCenterFrequencyChange={onCenterFrequencyChange}
        />
      </TestWrapper>,
    );

    const channelBButton = screen.getByRole("button", { name: "B" });
    fireEvent.click(channelBButton);

    expect(defaultProps.onHopChannelsChange).toHaveBeenCalledWith(["a", "b"]);

    // Should dispatch Channel A's native bandwidth (4_372_000), NOT summed bandwidth (10_642_000)
    expect(onBandwidthChange).toHaveBeenCalledWith(4_372_000);
    expect(onBandwidthChange).not.toHaveBeenCalledWith(10_642_000);

    // Should dispatch Channel A's native center (2_204_000), NOT ghost center (15_194_000)
    expect(onCenterFrequencyChange).toHaveBeenCalledWith(2_204_000);
    expect(onCenterFrequencyChange).not.toHaveBeenCalledWith(15_194_000);
  });
});

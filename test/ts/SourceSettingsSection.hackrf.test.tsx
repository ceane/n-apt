import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SourceSettingsSection } from "@n-apt/spectrum/sidebar/SourceSettingsSection";
import { TestWrapper } from "./testUtils";

jest.mock("@n-apt/ui/Tooltip", () => ({
  Tooltip: ({
    title,
    content,
    trigger,
  }: {
    title: string;
    content: string;
    trigger: React.ReactNode;
  }) => (
    <span data-testid={`tooltip-${title}`}>
      {trigger}
      <span data-testid={`tooltip-content-${title}`}>{content}</span>
    </span>
  ),
}));

describe("SourceSettingsSection HackRF controls", () => {
  it("shows HackRF-specific gain rows and AMP toggle", () => {
    const onHackrfLnaGainChange = jest.fn();
    const onHackrfVgaGainChange = jest.fn();
    const onHackrfAmpEnabledChange = jest.fn();
    const onHackrfBasebandBandwidthChange = jest.fn();

    render(
      <TestWrapper>
        <SourceSettingsSection
          sourceMode="live"
          deviceType="hackrf_one"
          ppm={1}
          gain={0}
          hackrfLnaGain={16}
          hackrfVgaGain={24}
          hackrfAmpEnabled={false}
          hackrfBasebandBandwidth={0}
          hackrfCurrentSampleRate={3_200_000}
          tunerAGC={false}
          rtlAGC={false}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onPpmChange={jest.fn()}
          onGainChange={jest.fn()}
          onHackrfLnaGainChange={onHackrfLnaGainChange}
          onHackrfVgaGainChange={onHackrfVgaGainChange}
          onHackrfAmpEnabledChange={onHackrfAmpEnabledChange}
          onHackrfBasebandBandwidthChange={onHackrfBasebandBandwidthChange}
          onTunerAGCChange={jest.fn()}
          onRtlAGCChange={jest.fn()}
          onStitchSourceSettingsChange={jest.fn()}
          onAgcModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("LNA gain")).toBeInTheDocument();
    expect(screen.getByText("VGA gain")).toBeInTheDocument();
    expect(screen.getByText("AMP enabled")).toBeInTheDocument();
    expect(screen.getByText("Baseband filter")).toBeInTheDocument();
    expect(screen.queryByText(/^Gain$/)).not.toBeInTheDocument();

    const lnaRow = screen.getByText("LNA gain").closest("div")
      ?.parentElement as HTMLElement;
    const vgaRow = screen.getByText("VGA gain").closest("div")
      ?.parentElement as HTMLElement;
    const ampRow = screen.getByText("AMP enabled").closest("div")
      ?.parentElement as HTMLElement;
    const basebandRow = screen.getByText("Baseband filter").closest("div")
      ?.parentElement as HTMLElement;

    const lnaInput = within(lnaRow).getByRole("spinbutton");
    const vgaInput = within(vgaRow).getByRole("spinbutton");
    const ampInput = within(ampRow).getByRole("checkbox");
    const basebandToggle = within(basebandRow).getByRole("checkbox");

    fireEvent.change(lnaInput, { target: { value: "40.0" } });
    fireEvent.change(vgaInput, { target: { value: "62" } });
    fireEvent.click(ampInput);
    fireEvent.click(basebandToggle);

    expect(onHackrfLnaGainChange).toHaveBeenLastCalledWith(40.0);
    expect(onHackrfVgaGainChange).toHaveBeenLastCalledWith(62);
    expect(onHackrfAmpEnabledChange).toHaveBeenLastCalledWith(true);
    expect(onHackrfBasebandBandwidthChange).toHaveBeenLastCalledWith(3_200_000);
  });

  it("shows a baseband warning when the filter is narrower than the sample rate", () => {
    render(
      <TestWrapper>
        <SourceSettingsSection
          sourceMode="live"
          deviceType="hackrf_one"
          ppm={1}
          gain={0}
          hackrfLnaGain={16}
          hackrfVgaGain={24}
          hackrfAmpEnabled={false}
          hackrfBasebandBandwidth={2_400_000}
          hackrfCurrentSampleRate={3_200_000}
          tunerAGC={false}
          rtlAGC={false}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onPpmChange={jest.fn()}
          onGainChange={jest.fn()}
          onHackrfLnaGainChange={jest.fn()}
          onHackrfVgaGainChange={jest.fn()}
          onHackrfAmpEnabledChange={jest.fn()}
          onHackrfBasebandBandwidthChange={jest.fn()}
          onTunerAGCChange={jest.fn()}
          onRtlAGCChange={jest.fn()}
          onStitchSourceSettingsChange={jest.fn()}
          onAgcModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(
      screen.getByTestId("tooltip-Baseband Filter Warning"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("tooltip-content-Baseband Filter Warning"),
    ).toHaveTextContent("scrunched");
    expect(screen.getByText("Baseband filter")).toBeInTheDocument();
  });

  it("shows gain warnings when HackRF gain exceeds the low-frequency threshold", () => {
    render(
      <TestWrapper>
        <SourceSettingsSection
          sourceMode="live"
          deviceType="hackrf_one"
          frequencyRangeMin={5_000_000}
          ppm={1}
          gain={0}
          hackrfLnaGain={16}
          hackrfVgaGain={24}
          hackrfAmpEnabled={true}
          hackrfBasebandBandwidth={0}
          hackrfCurrentSampleRate={3_200_000}
          tunerAGC={false}
          rtlAGC={false}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onPpmChange={jest.fn()}
          onGainChange={jest.fn()}
          onHackrfLnaGainChange={jest.fn()}
          onHackrfVgaGainChange={jest.fn()}
          onHackrfAmpEnabledChange={jest.fn()}
          onHackrfBasebandBandwidthChange={jest.fn()}
          onTunerAGCChange={jest.fn()}
          onRtlAGCChange={jest.fn()}
          onStitchSourceSettingsChange={jest.fn()}
          onAgcModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.getAllByTestId("tooltip-Gain Warning")).toHaveLength(3);
    expect(
      screen.getAllByTestId("tooltip-content-Gain Warning")[0],
    ).toHaveTextContent("Excessive gain");
    expect(screen.getByText("LNA gain")).toBeInTheDocument();
    expect(screen.getByText("VGA gain")).toBeInTheDocument();
    expect(screen.getByText("AMP enabled")).toBeInTheDocument();
  });

  it("clamps negative PPM values to zero in live mode", () => {
    const onPpmChange = jest.fn();

    render(
      <TestWrapper>
        <SourceSettingsSection
          sourceMode="live"
          deviceType="hackrf_one"
          ppm={1}
          gain={0}
          hackrfLnaGain={16}
          hackrfVgaGain={24}
          hackrfAmpEnabled={false}
          hackrfBasebandBandwidth={0}
          hackrfCurrentSampleRate={3_200_000}
          tunerAGC={false}
          rtlAGC={false}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onPpmChange={onPpmChange}
          onGainChange={jest.fn()}
          onHackrfLnaGainChange={jest.fn()}
          onHackrfVgaGainChange={jest.fn()}
          onHackrfAmpEnabledChange={jest.fn()}
          onHackrfBasebandBandwidthChange={jest.fn()}
          onTunerAGCChange={jest.fn()}
          onRtlAGCChange={jest.fn()}
          onStitchSourceSettingsChange={jest.fn()}
          onAgcModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    const ppmInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(ppmInput, { target: { value: "-12" } });

    expect(onPpmChange).toHaveBeenCalledWith(0);
  });

  it("hides AGC controls for HackRF live sources", () => {
    render(
      <TestWrapper>
        <SourceSettingsSection
          sourceMode="live"
          deviceType="hackrf_one"
          ppm={1}
          gain={0}
          hackrfLnaGain={16}
          hackrfVgaGain={24}
          hackrfAmpEnabled={false}
          hackrfBasebandBandwidth={0}
          hackrfCurrentSampleRate={3_200_000}
          tunerAGC={true}
          rtlAGC={true}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onPpmChange={jest.fn()}
          onGainChange={jest.fn()}
          onHackrfLnaGainChange={jest.fn()}
          onHackrfVgaGainChange={jest.fn()}
          onHackrfAmpEnabledChange={jest.fn()}
          onHackrfBasebandBandwidthChange={jest.fn()}
          onTunerAGCChange={jest.fn()}
          onRtlAGCChange={jest.fn()}
          onStitchSourceSettingsChange={jest.fn()}
          onAgcModeChange={jest.fn()}
        />
      </TestWrapper>,
    );

    expect(screen.queryByText("Tuner AGC")).not.toBeInTheDocument();
    expect(screen.queryByText("RTL AGC")).not.toBeInTheDocument();
  });

  it("shows RTL-SDR AGC controls and toggles them", () => {
    const onTunerAGCChange = jest.fn();
    const onRtlAGCChange = jest.fn();
    const onAgcModeChange = jest.fn();

    render(
      <TestWrapper>
        <SourceSettingsSection
          sourceMode="live"
          deviceType="rtl-sdr"
          ppm={1}
          gain={12}
          hackrfBasebandBandwidth={0}
          hackrfCurrentSampleRate={3_200_000}
          tunerAGC={false}
          rtlAGC={false}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onPpmChange={jest.fn()}
          onGainChange={jest.fn()}
          onHackrfBasebandBandwidthChange={jest.fn()}
          onTunerAGCChange={onTunerAGCChange}
          onRtlAGCChange={onRtlAGCChange}
          onStitchSourceSettingsChange={jest.fn()}
          onAgcModeChange={onAgcModeChange}
        />
      </TestWrapper>,
    );

    const tunerLabel = screen.getAllByText("Tuner AGC")[0];
    const rtlLabel = screen.getAllByText("RTL AGC")[0];

    expect(tunerLabel).toBeInTheDocument();
    expect(rtlLabel).toBeInTheDocument();
    expect(screen.queryByText("LNA gain")).not.toBeInTheDocument();

    const tunerRow = tunerLabel.closest("div")?.parentElement as HTMLElement;
    const rtlRow = rtlLabel.closest("div")?.parentElement as HTMLElement;

    const tunerInput = within(tunerRow).getByRole("checkbox");
    const rtlInput = within(rtlRow).getByRole("checkbox");

    fireEvent.click(tunerInput);
    fireEvent.click(rtlInput);

    expect(onTunerAGCChange).toHaveBeenNthCalledWith(1, true);
    expect(onRtlAGCChange).toHaveBeenNthCalledWith(1, false);
    expect(onAgcModeChange).toHaveBeenNthCalledWith(1, true, false);
    expect(onRtlAGCChange).toHaveBeenNthCalledWith(2, true);
    expect(onTunerAGCChange).toHaveBeenNthCalledWith(2, false);
    expect(onAgcModeChange).toHaveBeenNthCalledWith(2, false, true);
  });
});

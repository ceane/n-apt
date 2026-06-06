/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { TestWrapper } from "./testUtils";

describe("SnapshotControlsSection", () => {
  const renderSnapshotControls = (
    props: Partial<React.ComponentProps<typeof SnapshotControlsSection>> = {},
  ) => {
    const defaultProps: React.ComponentProps<typeof SnapshotControlsSection> = {
      snapshotWhole: false,
      snapshotShowWaterfall: false,
      snapshotShowStats: false,
      snapshotUseThemeColors: true,
      snapshotFormat: "png",
      snapshotGridPreference: true,
      snapshotShowGeolocation: false,
      snapshotGeolocationError: null,
      supportedSnapshotVideoFormat: null,
      snapshotAspectRatio: "default",
      onSnapshotWholeChange: jest.fn(),
      onSnapshotShowWaterfallChange: jest.fn(),
      onSnapshotShowStatsChange: jest.fn(),
      onSnapshotUseThemeColorsChange: jest.fn(),
      onSnapshotShowGeolocationChange: jest.fn(),
      onSnapshotFormatChange: jest.fn(),
      onSnapshotGridPreferenceChange: jest.fn(),
      onSnapshotAspectRatioChange: jest.fn(),
      onSnapshot: jest.fn(),
    };

    return render(<SnapshotControlsSection {...defaultProps} {...props} />, {
      wrapper: TestWrapper,
    });
  };

  it('renders the "Use Theme Colors?" toggle and keeps it wired', () => {
    const onSnapshotUseThemeColorsChange = jest.fn();

    renderSnapshotControls({ onSnapshotUseThemeColorsChange });

    fireEvent.click(screen.getByRole("button", { name: /take a snapshot/i }));

    expect(screen.getByText("Use Theme Colors?")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[2]).toBeChecked();

    fireEvent.click(checkboxes[2]);
    expect(onSnapshotUseThemeColorsChange).toHaveBeenCalledWith(false);
  });

  it("hides whole-channel snapshots when the source cannot capture the whole channel", () => {
    renderSnapshotControls({
      snapshotWhole: true,
      wholeChannelDisabled: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /take a snapshot/i }));

    const rangeSelect = screen.getAllByRole("combobox")[0];
    expect(rangeSelect).toHaveValue("onscreen");
    expect(
      screen.queryByRole("option", { name: "Whole Channel" }),
    ).not.toBeInTheDocument();
  });
});

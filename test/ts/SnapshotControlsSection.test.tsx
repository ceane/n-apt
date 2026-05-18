/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { TestWrapper } from "./testUtils";

describe("SnapshotControlsSection", () => {
  it('renders the "Use Theme Colors?" toggle and keeps it wired', () => {
    const onSnapshotUseThemeColorsChange = jest.fn();

    render(
      <SnapshotControlsSection
        snapshotWhole={false}
        snapshotShowWaterfall={false}
        snapshotShowStats={false}
        snapshotUseThemeColors={true}
        snapshotFormat="png"
        snapshotGridPreference={true}
        snapshotShowGeolocation={false}
        snapshotGeolocationError={null}
        supportedSnapshotVideoFormat={null}
        snapshotAspectRatio="default"
        onSnapshotWholeChange={jest.fn()}
        onSnapshotShowWaterfallChange={jest.fn()}
        onSnapshotShowStatsChange={jest.fn()}
        onSnapshotUseThemeColorsChange={onSnapshotUseThemeColorsChange}
        onSnapshotShowGeolocationChange={jest.fn()}
        onSnapshotFormatChange={jest.fn()}
        onSnapshotGridPreferenceChange={jest.fn()}
        onSnapshotAspectRatioChange={jest.fn()}
        onSnapshot={jest.fn()}
      />,
      { wrapper: TestWrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: /take a snapshot/i }));

    expect(screen.getByText("Use Theme Colors?")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[2]).toBeChecked();

    fireEvent.click(checkboxes[2]);
    expect(onSnapshotUseThemeColorsChange).toHaveBeenCalledWith(false);
  });
});

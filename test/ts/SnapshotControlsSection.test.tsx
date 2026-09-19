/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SnapshotControlsSection } from "@n-apt/capture/sidebar/SnapshotControlsSection";
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

  it("keeps disabled snapshot checkboxes undimmed with pointer cursors", () => {
    const onSnapshotUseThemeColorsChange = jest.fn();
    renderSnapshotControls({
      isFileMode: true,
      hasFileLoaded: false,
      onSnapshotUseThemeColorsChange,
    });

    fireEvent.click(screen.getByRole("button", { name: /take a snapshot/i }));

    const input = screen.getAllByRole("checkbox")[2];
    const label = input.parentElement!;
    const slider = input.nextElementSibling!;
    expect(input).toBeDisabled();
    expect(input).toBeChecked();
    expect(getComputedStyle(label).opacity).toBe("1");
    for (const element of [label, input, slider]) {
      expect(getComputedStyle(element).cursor).toBe("pointer");
    }
    expect(input).not.toHaveAttribute("$plainDisabled");
    fireEvent.click(label);
    expect(onSnapshotUseThemeColorsChange).not.toHaveBeenCalled();
  });

  it("preserves visual-only disabled select styling and inline widths", () => {
    renderSnapshotControls({ isFileMode: true, hasFileLoaded: false });
    fireEvent.click(screen.getByRole("button", { name: /take a snapshot/i }));

    for (const [index, select] of screen.getAllByRole("combobox").entries()) {
      expect(select).toBeEnabled();
      expect(select).not.toHaveAttribute("$disabled");
      const style = getComputedStyle(select);
      expect(style.opacity).toBe("0.5");
      expect(style.cursor).toBe("not-allowed");
      expect(style.minWidth).toBe(["120px", "100px", "110px"][index]);
      expect(style.maxWidth).toBe("100%");
      expect(style.boxSizing).toBe("border-box");
    }
  });

  it("keeps enabled select values and callbacks wired", () => {
    const onSnapshotAspectRatioChange = jest.fn();
    const onSnapshotFormatChange = jest.fn();
    renderSnapshotControls({ onSnapshotAspectRatioChange, onSnapshotFormatChange });
    fireEvent.click(screen.getByRole("button", { name: /take a snapshot/i }));

    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      expect(select).toBeEnabled();
      expect(getComputedStyle(select).opacity).toBe("1");
      expect(getComputedStyle(select).cursor).toBe("pointer");
    }
    fireEvent.change(selects[1], { target: { value: "16:9" } });
    expect(onSnapshotAspectRatioChange).toHaveBeenCalledWith("16:9");
    fireEvent.change(selects[2], { target: { value: "svg" } });
    expect(onSnapshotFormatChange).toHaveBeenCalledWith("svg");
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

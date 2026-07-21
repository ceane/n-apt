/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import {
  ChannelsSelector,
  ChannelsGrid,
} from "@n-apt/components/ui/ChannelsSelector";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import { Scan } from "lucide-react";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("ChannelsSelector and ChannelsGrid", () => {
  const channels = [
    { label: "A", min: 18_000, max: 4_390_000 },
    { label: "B", min: 24_100_000, max: 30_370_000 },
    { label: "C", min: 4_750_000, max: 23_000_000 },
  ];

  it("renders ChannelsGrid correctly with Ranges", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <ChannelsGrid
          channels={channels}
          selectedLabels={["A"]}
          onChange={onChange}
        />
      </ThemeProvider>,
    );

    // Verify all channels are rendered
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();

    // Click on Channel B and verify onChange is called
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });

  it("renders ChannelsSelector with custom header and icon", () => {
    const onChange = jest.fn();
    render(
      <ThemeProvider theme={theme}>
        <ChannelsSelector
          label="Test Channels"
          icon={Scan}
          headerExtra={<span data-testid="extra-header">Extra</span>}
          channels={channels}
          selectedLabels={["B", "C"]}
          onChange={onChange}
        />
      </ThemeProvider>,
    );

    // Verify label and header extra
    expect(screen.getByText("Test Channels")).toBeInTheDocument();
    expect(screen.getByTestId("extra-header")).toBeInTheDocument();

    // Click on Channel B (already selected) and verify it gets deselected
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith(["C"]);
  });
});

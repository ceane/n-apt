/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { DemodSidebarNodes } from "../../src/ts/components/sidebar/DemodSidebarNodes";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("DemodSidebarNodes", () => {
  it("explains symbols and bitstreams in plain language", () => {
    render(
      <ThemeProvider theme={theme}>
        <DemodSidebarNodes />
      </ThemeProvider>,
    );

    expect(
      screen.getByText(
        "Turns signal measurements like amplitude and phase into symbols that represent bits.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Turns those signal points into a stream of 0s and 1s—the raw data before it is organized.",
      ),
    ).toBeInTheDocument();
  });
});

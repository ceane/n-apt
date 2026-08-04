/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      screen.queryByText(
        "Turns signal measurements like amplitude and phase into symbols that represent bits.",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Node Library/i }));

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

  it("offers a Tx node for controlled demod experiments", () => {
    render(
      <ThemeProvider theme={theme}>
        <DemodSidebarNodes />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Node Library/i }));

    expect(screen.getByText("Tx")).toBeInTheDocument();
    expect(
      screen.getByText("Configure a transmit signal for controlled demod tests"),
    ).toBeInTheDocument();
  });

  it("offers a Waterfall Analysis node", () => {
    render(
      <ThemeProvider theme={theme}>
        <DemodSidebarNodes />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Node Library/i }));

    expect(screen.getByText("Waterfall Analysis")).toBeInTheDocument();
    expect(
      screen.getByText("Tune and inspect a waterfall signal window"),
    ).toBeInTheDocument();
  });
});

/** @jest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { DemodSidebarNodes } from "@n-apt/demodulation/sidebar/DemodSidebarNodes";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});
const hasEncryptedStimulusSource = fs.existsSync(
  path.resolve(
    process.cwd(),
    "src/encrypted-modules/tmp/ml/src/ts/features/demodulation/sidebar/StimulusNodeLibraryEntry.tsx",
  ),
);
const testWhenBundleUnavailable = hasEncryptedStimulusSource ? it.skip : it;

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

  it("offers a Phase node directly under the Symbols node", () => {
    render(
      <ThemeProvider theme={theme}>
        <DemodSidebarNodes />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Node Library/i }));

    const symbols = screen.getByText("Symbols (I/Q)");
    const phase = screen.getByText("Phase");

    expect(phase).toBeInTheDocument();
    expect(
      symbols.compareDocumentPosition(phase) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  testWhenBundleUnavailable("shows a retryable bundle fallback instead of an active ML stimulus entry", async () => {
    render(
      <ThemeProvider theme={theme}>
        <DemodSidebarNodes />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Node Library/i }));

    expect(
      await screen.findByRole("alert", { name: "Stimulus Node unavailable" }),
    ).toHaveTextContent(
      "The stimulus node isn't decrypted, so it can't be added from the node library yet.",
    );
    expect(
      screen.queryByText(
        "Record I/Q captures of N-APT channels using a baseline media content to detect where is what.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry Stimulus Node" }),
    ).toBeInTheDocument();
  });
});

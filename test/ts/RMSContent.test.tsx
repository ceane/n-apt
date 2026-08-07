import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import "@testing-library/jest-dom";
import { RMSContent } from "@n-apt/components/faq/RMSContent";
import { buildAppTheme } from "@n-apt/components/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("RMSContent", () => {
  it("renders the RMS explanation and signal-processing context", () => {
    render(
      <ThemeProvider theme={theme}>
        <RMSContent />
      </ThemeProvider>,
    );

    expect(screen.getByRole("heading", { name: /^RMS$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /What does RMS mean\?/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/root mean square/i)).toBeInTheDocument();
    expect(
      screen.getByText(/N-APT works with complex I\/Q samples/i),
    ).toBeInTheDocument();
  });
});

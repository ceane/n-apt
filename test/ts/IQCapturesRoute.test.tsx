import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import "@testing-library/jest-dom";
import { IQCapturesContent } from "@n-apt/components/faq/IQCapturesContent";
import { buildAppTheme } from "@n-apt/components/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("IQCapturesContent", () => {
  it("explains what captures store and produce during playback", () => {
    render(
      <ThemeProvider theme={theme}>
        <IQCapturesContent />
      </ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "I/Q captures" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/your radio turns what it receives/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /what an i\/q capture stores/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/what frequency was being listened to/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /what playback outputs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/spectrum and waterfall views/i),
    ).toBeInTheDocument();
  });
});

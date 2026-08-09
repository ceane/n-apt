import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import "@testing-library/jest-dom";
import { FFTIFFTContent } from "@n-apt/learn/faq/FFTIFFTContent";
import { buildAppTheme } from "@n-apt/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("FFTIFFTContent", () => {
  it("renders FFT & IFFT explanation content", () => {
    render(
      <ThemeProvider theme={theme}>
        <FFTIFFTContent />
      </ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", {
        name: /FFT \(Fast Fourier Transform\) and IFFT \(Inverse Fast Fourier Transform\)/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /^What is FFT\?$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^What is IFFT\?$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^How N-APT uses FFT & IFFT$/i }),
    ).toBeInTheDocument();
  });
});

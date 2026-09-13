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

    expect(screen.getByText("1. One sine-wave cycle")).toBeInTheDocument();
    expect(
      screen.getByText("2. Two-sided / Natural waveform"),
    ).toBeInTheDocument();
    expect(screen.getByText("3. Frequency bins")).toBeInTheDocument();
    expect(screen.getByText("4. Twiddle factor")).toBeInTheDocument();
    expect(screen.getByText("5. Butterfly")).toBeInTheDocument();
    expect(screen.getByText("6. Magnitude based waveform")).toBeInTheDocument();
    expect(
      screen.getByText(
        /same 2,048-point block becomes a magnitude based waveform/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("fft-natural-sample-point")).toHaveLength(
      2048,
    );
    expect(screen.getByText("2,048 points / FFT size")).toBeInTheDocument();
    expect(screen.getByTestId("fft-magnitude-trace")).toBeInTheDocument();
    expect(screen.getByTestId("fft-magnitude-fill")).toBeInTheDocument();
    expect(screen.getByTestId("fft-magnitude-trace")).toHaveAttribute(
      "stroke-linecap",
      "round",
    );
    expect(screen.getByTestId("fft-magnitude-trace")).toHaveAttribute(
      "stroke-linejoin",
      "round",
    );
    expect(screen.queryByTestId("fft-dc-center-line")).not.toBeInTheDocument();
    expect(screen.getAllByText("0 kHz")).toHaveLength(2);
    expect(screen.getAllByText("2 kHz")).toHaveLength(2);
    expect(screen.getAllByText("4 kHz")).toHaveLength(2);
    expect(screen.getAllByText("6 kHz")).toHaveLength(2);
    expect(screen.getAllByText("8 kHz")).toHaveLength(2);
    expect(screen.getAllByText("↓")).toHaveLength(5);
    expect(
      screen.getAllByText(/does not measure every individual Hz/i),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(/bin width = sample rate ÷ FFT size/i),
    ).toHaveLength(2);
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "styled-components";
import "@testing-library/jest-dom";
import { FFTIFFTRoute } from "@n-apt/routes/FFTIFFTRoute";
import { buildAppTheme } from "@n-apt/components/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("FFTIFFTRoute", () => {
  it("renders FFT & IFFT explanation content and sidebar links", () => {
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={["/faq/fft-ifft"]}>
          <FFTIFFTRoute />
        </MemoryRouter>
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

    expect(screen.getByRole("link", { name: "I/Q Capture" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FFT & IFFT" })).toBeInTheDocument();
  });
});

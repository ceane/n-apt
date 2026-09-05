import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { THEME_TOKENS } from "@n-apt/consts/theme";
import FileMetadata from "@n-apt/capture/sidebar/FileMetadata";

jest.mock("@n-apt/redux", () => ({
  useAppSelector: (selector: any) =>
    selector({
      waterfall: {
        activePlaybackMetadata: null,
        sourceMode: "file",
      },
      websocket: {
        captureStatus: null,
      },
    }),
}));

jest.mock("@n-apt/app/infrastructure/io/fileRegistry", () => ({
  fileRegistry: {
    get: jest.fn(() => ({ size: 241_696 })),
  },
}));

describe("FileMetadata", () => {
  it("renders file frequency metadata with enough precision to avoid MHz truncation", () => {
    const theme = {
      mode: "dark" as const,
      requestedMode: "system" as const,
      waterfallTheme: "magma",
      colors: THEME_TOKENS.colors.dark,
      typography: THEME_TOKENS.typography,
      spacing: THEME_TOKENS.spacing,
      layout: THEME_TOKENS.layout,
      cssVariables: {},
      primary: "#00d4ff",
      primaryAlpha: "#00d4ff33",
      primaryAnchor: "#00d4ff1a",
      fft: "#00d4ff",
      background: THEME_TOKENS.colors.dark.background,
      surface: THEME_TOKENS.colors.dark.surface,
      border: THEME_TOKENS.colors.dark.border,
      textPrimary: THEME_TOKENS.colors.dark.textPrimary,
      textSecondary: THEME_TOKENS.colors.dark.textSecondary,
      metadataLabel: THEME_TOKENS.colors.dark.metadataLabel,
      danger: THEME_TOKENS.colors.dark.danger,
    };

    render(
      <ThemeProvider theme={theme}>
        <FileMetadata
          selectedNaptFile={{ id: "capture", name: "capture.napt" }}
          naptMetadata={{
            center_frequency_hz: 1_618_000,
            capture_sample_rate_hz: 3_200_000,
            hardware_sample_rate_hz: 3_200_000,
            frequency_range: [18_000, 3_218_000],
            acquisition_mode: "whole_sample",
          }}
          naptMetadataError={null}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("1.618MHz")).toBeInTheDocument();
    expect(screen.getAllByText("3.2MHz")).toHaveLength(2);
    expect(screen.getByText("18kHz")).toBeInTheDocument();
    expect(screen.getByText("3.218MHz")).toBeInTheDocument();
  });

  it("does not render a duplicate file metadata card", () => {
    const theme = {
      mode: "dark" as const,
      requestedMode: "system" as const,
      waterfallTheme: "magma",
      colors: THEME_TOKENS.colors.dark,
      typography: THEME_TOKENS.typography,
      spacing: THEME_TOKENS.spacing,
      layout: THEME_TOKENS.layout,
      cssVariables: {},
      primary: "#00d4ff",
      primaryAlpha: "#00d4ff33",
      primaryAnchor: "#00d4ff1a",
      fft: "#00d4ff",
      background: THEME_TOKENS.colors.dark.background,
      surface: THEME_TOKENS.colors.dark.surface,
      border: THEME_TOKENS.colors.dark.border,
      textPrimary: THEME_TOKENS.colors.dark.textPrimary,
      textSecondary: THEME_TOKENS.colors.dark.textSecondary,
      metadataLabel: THEME_TOKENS.colors.dark.metadataLabel,
      danger: THEME_TOKENS.colors.dark.danger,
    };

    render(
      <ThemeProvider theme={theme}>
        <FileMetadata
          selectedNaptFile={{ id: "capture", name: "capture.napt" }}
          naptMetadata={{ center_frequency_hz: 1_000_000 }}
          naptMetadataError={null}
        />
      </ThemeProvider>,
    );

    expect(screen.queryByText("File", { exact: true })).not.toBeInTheDocument();
  });
});

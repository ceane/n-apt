import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import FileSelectionSidebar from "@n-apt/capture/sidebar/FileSelectionSidebar";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("FileSelectionSidebar", () => {
  it("shows the loaded capture duration in the selected file card", () => {
    render(
      <ThemeProvider theme={theme}>
        <FileSelectionSidebar
          selectedFiles={[{ id: "capture-1", name: "capture.napt" }]}
          onSelectedFilesChange={jest.fn()}
          stitchStatus="Processed Successfully"
          isStitchPaused={true}
          onClear={jest.fn()}
          selectedPrimaryFile={null}
          naptMetadata={{ duration_s: 12.5 }}
          naptMetadataError={null}
          showMetadata={false}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("12s length capture")).toBeInTheDocument();
  });
});

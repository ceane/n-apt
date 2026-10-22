import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import FileSelectionSidebar from "@n-apt/capture/sidebar/FileSelectionSidebar";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import waterfallSlice from "@n-apt/redux/slices/waterfallSlice";

const createStore = () =>
  configureStore({ reducer: { waterfall: waterfallSlice } });

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("FileSelectionSidebar", () => {
  it("keeps the selected file and metadata sections compact", () => {
    render(
      <Provider store={createStore()}>
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
          />
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByTestId("file-selection-layout")).toHaveStyle({ gap: "8px" });
    expect(screen.getByTestId("sidebar-selected-file")).toHaveStyle({ gap: "8px" });
    expect(screen.getByTestId("sidebar-file-metadata")).toHaveStyle({ marginTop: "0" });
  });

  it("shows the loaded capture duration in the selected file card", () => {
    render(
      <Provider store={createStore()}>
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
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByText("12s length capture")).toBeInTheDocument();
  });
});

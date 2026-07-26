import * as React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { SignalFeaturesSection } from "../../src/ts/components/sidebar/SignalFeaturesSection";
import { THEME_TOKENS } from "@n-apt/consts/theme";

jest.mock("@n-apt/components/ui", () => ({
  Row: ({
    label,
    children,
  }: {
    label: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  ),
  Collapsible: ({
    children,
    label,
    defaultOpen,
  }: {
    children: React.ReactNode;
    label: string;
    defaultOpen?: boolean;
  }) => (
    <div data-testid="collapsible">
      <button type="button">{label}</button>
      {defaultOpen && <div>{children}</div>}
    </div>
  ),
  CollapsibleTitle: ({
    label,
    isOpen,
    onToggle,
  }: {
    label: string;
    isOpen: boolean;
    onToggle: () => void;
  }) => (
    <button type="button" onClick={onToggle}>
      {label} {isOpen ? "open" : "closed"}
    </button>
  ),
}));

const theme = {
  mode: "dark" as const,
  requestedMode: "system" as const,
  waterfallTheme: "classic",
  colors: THEME_TOKENS.colors.dark,
  typography: THEME_TOKENS.typography,
  spacing: THEME_TOKENS.spacing,
  layout: THEME_TOKENS.layout,
  primary: "#00ffff",
  primaryAlpha: "#00ffff33",
  primaryAnchor: "#00ffff1a",
  fft: "#00ffff",
  cssVariables: {},
};

describe("SignalFeaturesSection", () => {
  const defaultProps = {
    sourceMode: "live" as const,
    deviceState: "connected",
    isConnected: true,
    selectedFilesCount: 0,
    showSpikeOverlay: false,
    onShowSpikeOverlayChange: jest.fn(),
  };

  const renderComponent = (props = {}) =>
    render(
      <ThemeProvider theme={theme}>
        <SignalFeaturesSection {...defaultProps} {...props} />
      </ThemeProvider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });
  it("renders signal classification controls", () => {
    expect(renderComponent().container).not.toBeEmptyDOMElement();
  });
});

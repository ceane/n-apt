import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { SignalFeaturesSection } from "../../src/ts/components/sidebar/SignalFeaturesSection";

jest.mock("@n-apt/components/ui", () => ({
  Row: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  ),
  Collapsible: ({ children, label, defaultOpen }: {
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
  primary: "#00ffff",
  textMuted: "#888888",
  typography: {
    mono: "monospace",
  },
};

describe("SignalFeaturesSection", () => {
  const defaultProps = {
    sourceMode: "live" as const,
    deviceState: "connected",
    isConnected: true,
    selectedFilesCount: 0,
    showSpikeOverlay: false,
    onShowSpikeOverlayChange: jest.fn(),
    heterodyningStatusText: "Idle",
    heterodyningVerifyDisabled: false,
    onVerifyHeterodyning: jest.fn(),
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

  it("shows heterodyning status text from props", () => {
    renderComponent({ heterodyningStatusText: "Detected (0.82)" });

    expect(screen.getByText("Detected (0.82)")).toBeInTheDocument();
  });

  it("calls onVerifyHeterodyning when Verify is clicked", () => {
    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(defaultProps.onVerifyHeterodyning).toHaveBeenCalledTimes(1);
  });

  it("disables Verify when heterodyning verification is unavailable", () => {
    renderComponent({ heterodyningVerifyDisabled: true });

    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
  });
});

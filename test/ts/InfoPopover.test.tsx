import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import InfoPopover from "@n-apt/components/InfoPopover";

describe("InfoPopover Component", () => {
  const mockContent = "Test content for popover";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render without crashing", () => {
    render(<InfoPopover content={mockContent} />);

    expect(screen.getByText("i")).toBeInTheDocument();
  });

  it("should show popover content immediately", () => {
    render(<InfoPopover content={mockContent} />);

    // Content should be visible immediately
    expect(screen.getByText("Test content for popover")).toBeInTheDocument();
  });

  it("should display title when provided", () => {
    render(<InfoPopover title="Custom Title" content={mockContent} />);

    expect(screen.getByText("Custom Title")).toBeInTheDocument();
    expect(screen.getByText("Test content for popover")).toBeInTheDocument();
  });

  it("should use default title when none provided", () => {
    render(<InfoPopover content={mockContent} />);

    expect(screen.getByText("Information")).toBeInTheDocument();
  });

  it("should handle long content", () => {
    const longContent =
      "This is a very long content that should wrap properly and be displayed correctly in the popover without breaking the layout or causing overflow issues.";

    render(<InfoPopover content={longContent} />);

    expect(screen.getByText(longContent)).toBeInTheDocument();
  });

  it("should handle multiple popovers", () => {
    render(
      <div>
        <InfoPopover content="Content 1" title="Title 1" />
        <InfoPopover content="Content 2" title="Title 2" />
      </div>,
    );

    expect(screen.getByText("Content 1")).toBeInTheDocument();
    expect(screen.getByText("Content 2")).toBeInTheDocument();
    expect(screen.getByText("Title 1")).toBeInTheDocument();
    expect(screen.getByText("Title 2")).toBeInTheDocument();
  });

  it("should handle special characters in content", () => {
    const specialContent =
      "Content with special chars: @#$%^&*()_+-=[]{}|;:,.<>?";

    render(<InfoPopover content={specialContent} />);

    expect(screen.getByText(specialContent)).toBeInTheDocument();
  });

  it("should handle empty content", () => {
    render(<InfoPopover content="" />);

    // Should still render the popover structure
    expect(screen.getByText("Information")).toBeInTheDocument();
  });

  it("should render multiple icons correctly", () => {
    render(
      <div>
        <InfoPopover content="Content 1" />
        <InfoPopover content="Content 2" />
      </div>,
    );

    const icons = screen.getAllByText("i");
    expect(icons).toHaveLength(2);
  });
});

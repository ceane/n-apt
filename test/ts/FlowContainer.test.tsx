import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { FlowContainer } from "@n-apt/components/react-flow/flows/FlowContainer";
import { TestWrapper } from "./testUtils";

describe("FlowContainer", () => {
  it("renders children correctly", () => {
    render(
      <TestWrapper>
        <FlowContainer>
          <div>Test Content</div>
        </FlowContainer>
      </TestWrapper>
    );

    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("renders as a div with correct structure", () => {
    const { container } = render(
      <TestWrapper>
        <FlowContainer>
          <div>Test Content</div>
        </FlowContainer>
      </TestWrapper>
    );

    const flowContainer = container.firstChild;
    expect(flowContainer).toBeInTheDocument();
    expect(flowContainer).toHaveStyle({
      width: "100%",
      height: "100%",
    });
  });

  it("renders multiple children", () => {
    render(
      <TestWrapper>
        <FlowContainer>
          <div>Child 1</div>
          <div>Child 2</div>
          <div>Child 3</div>
        </FlowContainer>
      </TestWrapper>
    );

    expect(screen.getByText("Child 1")).toBeInTheDocument();
    expect(screen.getByText("Child 2")).toBeInTheDocument();
    expect(screen.getByText("Child 3")).toBeInTheDocument();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
// @ts-ignore - Jest module mapper handles this
import { NodeContainer } from "@n-apt/components/react-flow/nodes/NodeContainer";
import { TestWrapper } from "./testUtils";

describe("NodeContainer", () => {
  it("renders children correctly", () => {
    render(
      <TestWrapper>
        <NodeContainer data-nodeid="test-node">
          <div>Test Content</div>
        </NodeContainer>
      </TestWrapper>
    );

    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("passes data-nodeid attribute", () => {
    const { container } = render(
      <TestWrapper>
        <NodeContainer data-nodeid="test-node">
          <div>Test Content</div>
        </NodeContainer>
      </TestWrapper>
    );

    const nodeContainer = container.querySelector('[data-nodeid="test-node"]');
    expect(nodeContainer).toBeInTheDocument();
  });

  it("renders without data-nodeid attribute", () => {
    const { container } = render(
      <TestWrapper>
        <NodeContainer>
          <div>Test Content</div>
        </NodeContainer>
      </TestWrapper>
    );

    const nodeContainer = container.firstChild;
    expect(nodeContainer).toBeInTheDocument();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  DemodFlowContext,
  useDemodFlow,
} from "@n-apt/demodulation/context/DemodFlowContext";

const Probe = () => {
  const { nodes, edges } = useDemodFlow();
  return <div data-testid="flow-counts">{nodes.length}:{edges.length}</div>;
};

describe("DemodFlowContext", () => {
  it("provides flow state independently from the broader demod context", () => {
    render(
      <DemodFlowContext.Provider
        value={{
          nodes: [{ id: "source" } as any],
          edges: [],
          onNodesChange: jest.fn(),
          onEdgesChange: jest.fn(),
          setNodes: jest.fn(),
          setEdges: jest.fn(),
          clearFlow: jest.fn(),
          setFlow: jest.fn(),
          flowVersion: 2,
        }}
      >
        <Probe />
      </DemodFlowContext.Provider>,
    );

    expect(screen.getByTestId("flow-counts")).toHaveTextContent("1:0");
  });
});

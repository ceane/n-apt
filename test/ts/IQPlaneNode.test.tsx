import React from "react";
import { render, screen } from "@testing-library/react";
import { IQPlaneNode } from "@n-apt/demodulation/react-flow/nodes/IQPlaneNode";
import { TestWrapper } from "./testUtils";

describe("IQPlaneNode", () => {
  it("renders against the active live frame runtime", () => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    render(<IQPlaneNode />, { wrapper: TestWrapper });

    const node = screen.getByTestId("iq-plane-node");
    expect(node).toBeInTheDocument();
    expect(getComputedStyle(node).width).toBe("560px");
    expect(getComputedStyle(node).height).toBe("400px");
    expect(screen.getByText(/Sample rate/)).toHaveTextContent(
      "Sample rate — · Center —",
    );
    expect(screen.getByText(/Auto-scaled I\/Q/)).toHaveTextContent(
      "Sample rate — · Center — · Auto-scaled I/Q · — samples",
    );
    const signedRange = screen.getByLabelText(
      "I/Q signed range from minus 128 to plus 127",
    );
    expect(signedRange).toHaveTextContent("I/Q signed range");
    expect(signedRange).toHaveTextContent("−128");
    expect(signedRange).toHaveTextContent("0");
    expect(signedRange).toHaveTextContent("+127");
  });
});

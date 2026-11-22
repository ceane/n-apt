import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { IQPlaneNode } from "@n-apt/demodulation/react-flow/nodes/IQPlaneNode";
import { TestWrapper } from "./testUtils";

describe("IQPlaneNode", () => {
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders against the active live frame runtime", () => {
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

  it("zooms only the I/Q plot with its header controls", () => {
    render(<IQPlaneNode />, { wrapper: TestWrapper });

    expect(screen.getByTestId("iq-plane-zoom-readout")).toHaveTextContent(
      "1.0×",
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom I/Q in" }));
    expect(screen.getByTestId("iq-plane-zoom-readout")).toHaveTextContent(
      "1.2×",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset I/Q zoom" }));
    expect(screen.getByTestId("iq-plane-zoom-readout")).toHaveTextContent(
      "1.0×",
    );
    fireEvent.wheel(
      screen.getByLabelText(
        "I/Q plot. Use the mouse wheel or header controls to zoom.",
      ),
      { deltaY: -100 },
    );
    expect(screen.getByTestId("iq-plane-zoom-readout")).toHaveTextContent(
      "1.2×",
    );
  });
});

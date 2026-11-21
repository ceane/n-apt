import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Model3DProvider, useModel3D } from "@n-apt/three-d/hooks/useModel3D";

const SelectionFocusHarness: React.FC = () => {
  const { selectedArea, selectionRequest, setSelectedArea } = useModel3D();
  const area = {
    name: "Pulmonary autonomic plexus",
    position: [0, 1.4, 1] as [number, number, number],
    target: [0, 1.4, 0] as [number, number, number],
    meshName: "o_ADBody",
    highlightType: "nerve" as const,
  };

  return (
    <>
      <button type="button" onClick={() => setSelectedArea(area)}>Focus lungs</button>
      <output data-testid="selection-request">{selectionRequest}</output>
      <output data-testid="selected-area">{selectedArea?.name ?? "none"}</output>
    </>
  );
};

describe("3D anatomy focus requests", () => {
  test("re-requests camera focus when the already-selected card is clicked again", () => {
    render(
      <Model3DProvider>
        <SelectionFocusHarness />
      </Model3DProvider>,
    );

    const focusButton = screen.getByRole("button", { name: "Focus lungs" });
    fireEvent.click(focusButton);
    expect(screen.getByTestId("selected-area")).toHaveTextContent("Pulmonary autonomic plexus");
    expect(screen.getByTestId("selection-request")).toHaveTextContent("1");

    fireEvent.click(focusButton);
    expect(screen.getByTestId("selection-request")).toHaveTextContent("2");
  });
});

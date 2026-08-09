import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Vfo, resolveVfoOptions } from "@n-apt/layout/vfo/Vfo";

describe("unified VFO", () => {
  it("normalizes one shared contract for default, compact, and snapshot states", () => {
    expect(
      resolveVfoOptions({
        visualState: "compact",
        drawingType: "dom",
        orientation: "top",
        cursorMotion: true,
        tickPrecision: "reduced",
      }),
    ).toMatchObject({
      visualState: "compact",
      drawingType: "dom",
      orientation: "top",
      cursorMotion: true,
      tickPrecision: "reduced",
    });
  });

  it("uses orientation for the DOM tick level and exposes a center status slot", () => {
    render(
      <Vfo
        visualState="compact"
        drawingType="dom"
        orientation="top"
        frequencyRange={{ min: -500, max: 500 }}
        centerFrequencyHz={100}
        cursorMotion={false}
        tickPrecision="default"
        accessory={<span>Even Bins</span>}
      />,
    );

    const vfo = screen.getByTestId("unified-vfo");
    expect(vfo).toHaveAttribute("data-orientation", "top");
    expect(vfo).toHaveAttribute("data-drawing-type", "dom");
    expect(vfo).toHaveAttribute("data-tick-level", "top");
    expect(screen.getByTestId("unified-vfo-status")).toHaveTextContent(
      "Even Bins",
    );
    expect(screen.getByText("-500 Hz")).toBeInTheDocument();
    expect(screen.getByText("500 Hz")).toBeInTheDocument();
  });
});

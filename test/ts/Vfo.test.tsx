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

  it("keeps compact edge and center labels anchored while moving only the cursor line", () => {
    render(
      <Vfo
        visualState="compact"
        drawingType="dom"
        orientation="top"
        frequencyRange={{ min: 0, max: 4_000_000 }}
        centerFrequencyHz={2_000_000}
        cursorMotion
        cursorOffsetPx={24}
      />,
    );

    expect(screen.getByTestId("unified-vfo-edge-left")).toHaveTextContent(
      "0 Hz",
    );
    expect(screen.getByTestId("unified-vfo-edge-right")).toHaveTextContent(
      "4 MHz",
    );
    expect(screen.getByTestId("unified-vfo-center-label")).toHaveTextContent(
      "○ 2 MHz",
    );
    expect(screen.getByTestId("unified-vfo-cursor-line")).toHaveAttribute(
      "data-offset-px",
      "24",
    );
    expect(screen.getByTestId("unified-vfo-center-label")).not.toHaveAttribute(
      "data-offset-px",
    );
    expect(screen.getByTestId("unified-vfo-center-row")).toHaveAttribute(
      "data-vertical-alignment",
      "center",
    );
    expect(screen.getByTestId("unified-vfo-cursor-line")).toHaveAttribute(
      "data-vertical-alignment",
      "center",
    );
  });
});

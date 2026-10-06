import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VisionScene } from "@n-apt/three-d/VisionScene";

describe("VisionScene", () => {
  test.each(["S", "M", "L", "Red"] as const)(
    "keeps a high-contrast yellow progress fill for the %s screen",
    (preset) => {
      render(
        <VisionScene
          session={{
            state: "capturing",
            type: "vision",
            startTime: Date.now() - 1000,
            durationS: 5,
          }}
          preset={preset}
        />,
      );

      const track = screen.getByRole("progressbar", {
        name: "Vision stimulus countdown",
      });
      const fill = track.firstElementChild;

      expect(fill).not.toBeNull();
      expect(getComputedStyle(fill as Element).backgroundColor).toBe(
        "rgb(255, 230, 0)",
      );
      expect(getComputedStyle(track).mixBlendMode).toBe("normal");
    },
  );

  test("shows only the selected full-screen color and a duration-driven top progress bar", () => {
    render(
      <VisionScene
        session={{
          state: "capturing",
          type: "vision",
          startTime: Date.now() - 1000,
          durationS: 5,
        }}
        preset="L"
      />,
    );
    expect(screen.getByTestId("vision-stimulus-screen")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Vision stimulus countdown" }),
    ).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByTestId("vision-stimulus-screen")).toHaveTextContent(
      /^$/,
    );
  });
  test("uses the preparation color and starts with a full bar while waiting for capture", () => {
    render(
      <VisionScene
        session={{
          state: "starting",
          type: "vision",
          startTime: Date.now(),
          durationS: 10,
        }}
        preset="S"
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  getPopoverPosition,
  Popover,
} from "@n-apt/ui/Popover";

describe("Popover", () => {
  test("clamps both horizontal anchor modes and flips above when needed", () => {
    expect(
      getPopoverPosition({
        anchorRect: { top: 40, bottom: 64, left: 300, right: 324 },
        popoverSize: { width: 190, height: 120 },
        viewportSize: { width: 800, height: 600 },
        horizontalAnchor: "left",
      }),
    ).toEqual({ top: 72, left: 300 });

    expect(
      getPopoverPosition({
        anchorRect: { top: 540, bottom: 564, left: 740, right: 764 },
        popoverSize: { width: 190, height: 120 },
        viewportSize: { width: 800, height: 600 },
        horizontalAnchor: "right",
      }),
    ).toEqual({ top: 412, left: 574 });
  });

  test("portals beside its trigger and closes from Escape", () => {
    const onClose = jest.fn();
    const TriggeredPopover = () => {
      const anchorRef = React.useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button ref={anchorRef} data-testid="trigger" />
          <Popover
            open
            anchorRef={anchorRef}
            onClose={onClose}
            role="dialog"
            aria-label="Example popover"
          >
            Content
          </Popover>
        </>
      );
    };
    render(<TriggeredPopover />);

    expect(screen.getByRole("dialog", { name: "Example popover" })).toBe(
      document.body.lastElementChild,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

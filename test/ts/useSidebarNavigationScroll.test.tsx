import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useSidebarNavigationScroll } from "../../src/ts/hooks/useSidebarNavigationScroll";

// jsdom does not implement Element#scrollTo; the hook relies on it.
Element.prototype.scrollTo = function (
  this: HTMLElement,
  options?: ScrollToOptions,
) {
  this.scrollTop = (options && options.top) || 0;
} as typeof Element.prototype.scrollTo;

const ScrollHarness: React.FC<{ entry: string }> = ({ entry }) => {
  const { navigationContainerRef } = useSidebarNavigationScroll({ path: "/" });
  return (
    <div
      ref={navigationContainerRef}
      data-testid="nav-container"
      style={{ overflowY: "auto", height: 500 }}
    >
      <div style={{ height: 300 }}>sidebar header + routes nav</div>
      <div data-sidebar-sticky-header style={{ height: 80 }}>
        Source header
      </div>
      <div style={{ height: 2000 }}>content</div>
    </div>
  );
};

describe("useSidebarNavigationScroll file selection deep link", () => {
  it("scrolls the sticky source header to the top when source=fileSelection", () => {
    // jsdom returns zeroed rects; model the geometry the hook relies on so the
    // sticky header (300px down) aligns to the container top (scrollTop 300).
    const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const height = this.getAttribute?.("height") ?? null;
      const isHeader = this.hasAttribute?.("data-sidebar-sticky-header");
      if (this.getAttribute?.("data-testid") === "nav-container") {
        return {
          top: 0,
          bottom: 500,
          left: 0,
          right: 300,
          height: 500,
          width: 300,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (isHeader) {
        return {
          top: 300,
          bottom: 380,
          left: 0,
          right: 300,
          height: 80,
          width: 300,
          x: 0,
          y: 300,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return realGetBoundingClientRect.call(this);
    };

    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/?source=fileSelection"]}>
        <ScrollHarness entry="/?source=fileSelection" />
      </MemoryRouter>,
    );
    const container = getByTestId("nav-container") as HTMLDivElement;

    // The layout effect runs on mount and scrolls to align the header top with
    // the container top (300 - 0 = 300). rAF retries confirm the same target.
    expect(container.scrollTop).toBe(300);

    Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
  });
});

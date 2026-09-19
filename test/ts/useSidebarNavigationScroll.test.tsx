import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
const Router = require("react-router") as typeof import("react-router");
import { useSidebarNavigationScroll } from "@n-apt/app/hooks/useSidebarNavigationScroll";

// jsdom does not implement Element#scrollTo; the hook relies on it.
Element.prototype.scrollTo = function (
  this: HTMLElement,
  options?: ScrollToOptions,
) {
  this.scrollTop = (options && options.top) || 0;
} as typeof Element.prototype.scrollTo;

const ScrollHarness: React.FC<{ entry: string }> = ({ entry: _entry }) => {
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

type AlignmentHarnessProps = {
  header?: boolean;
  section?: boolean;
  root?: boolean;
};

const AlignmentHarness = ({ header, section, root }: AlignmentHarnessProps) => {
  const { navigationContainerRef, sidebarToggleRef } =
    useSidebarNavigationScroll({ path: "/settings" });
  return (
    <div ref={navigationContainerRef} data-testid="alignment-container">
      <button ref={sidebarToggleRef} data-toggle />
      {header && <div data-sidebar-sticky-header />}
      {section && <div data-sidebar-section="theme" data-offset="340" />}
      {root && <div data-sidebar-scroll-root="theme" data-offset="540" />}
    </div>
  );
};

const alignmentCases = [
  {
    name: "header",
    search: "?source=fileSelection",
    attribute: "data-sidebar-sticky-header",
  },
  {
    name: "section",
    search: "?sidebarSection=theme&keep=yes",
    attribute: "data-sidebar-section",
  },
];

describe("useSidebarNavigationScroll bounded alignment", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let navigate: jest.Mock;
  let location: {
    pathname: string;
    search: string;
    hash: string;
    state: null;
    key: string;
  };
  let scrollTo: jest.SpyInstance;

  const advanceFrame = () => {
    const pending = Array.from(frames.values());
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  };

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    navigate = jest.fn();
    location = {
      pathname: "/settings",
      search: "",
      hash: "",
      state: null,
      key: "test",
    };
    jest.spyOn(Router, "useLocation").mockImplementation(() => location);
    jest.spyOn(Router, "useNavigate").mockReturnValue(navigate);
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    scrollTo = jest.spyOn(Element.prototype, "scrollTo");
    jest
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const container = this.closest(
          '[data-testid="alignment-container"]',
        ) as HTMLElement | null;
        let top = 100;
        let height = 500;
        if (this.hasAttribute("data-toggle")) height = 20;
        else if (this.hasAttribute("data-sidebar-sticky-header")) {
          top = Math.max(100, 400 - (container?.scrollTop ?? 0));
          height = 80;
        } else if (this.hasAttribute("data-offset")) {
          top += Number(this.dataset.offset) - (container?.scrollTop ?? 0);
          height = 40;
        }
        return {
          top,
          bottom: top + height,
          height,
          left: 0,
          right: 300,
          width: 300,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      });
  });

  afterEach(() => {
    const container = document.querySelector(
      '[data-testid="alignment-container"]',
    );
    if (container) container.scrollTop = 0;
    cleanup();
    jest.restoreAllMocks();
  });

  it.each(alignmentCases)(
    "stops $name lookup after exactly 60 synchronous/frame attempts",
    ({ search, attribute }) => {
      location.search = search;
      const query = jest.spyOn(Element.prototype, "querySelector");
      const queryAll = jest.spyOn(Element.prototype, "querySelectorAll");
      const { getByTestId } = render(<AlignmentHarness />);
      const lookupCount = () =>
        attribute === "data-sidebar-sticky-header"
          ? query.mock.calls.filter(
              ([selector]) => selector === `[${attribute}]`,
            ).length
          : queryAll.mock.calls.filter(
              ([selector]) => selector === `[${attribute}]`,
            ).length;
      expect(lookupCount()).toBe(1);
      for (let index = 0; index < 59; index += 1) advanceFrame();
      expect(lookupCount()).toBe(60);
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(59);
      expect(frames.size).toBe(0);
      const target = document.createElement("div");
      target.setAttribute(attribute, "theme");
      getByTestId("alignment-container").appendChild(target);
      advanceFrame();
      expect(lookupCount()).toBe(60);
      expect(scrollTo).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it.each(alignmentCases)(
    "aligns $name when it appears on the final allowed attempt",
    ({ search, attribute }) => {
      location.search = search;
      const { getByTestId } = render(<AlignmentHarness />);
      for (let index = 0; index < 58; index += 1) advanceFrame();
      const target = document.createElement("div");
      target.setAttribute(attribute, "theme");
      target.dataset.offset = "340";
      getByTestId("alignment-container").appendChild(target);
      advanceFrame();
      expect(scrollTo).toHaveBeenCalledWith({
        top: attribute === "data-sidebar-sticky-header" ? 300 : 308,
        behavior: "auto",
      });
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it.each(alignmentCases)(
    "cancels pending $name lookup and ignores stale callbacks on unmount",
    ({ search }) => {
      location.search = search;
      const { unmount } = render(<AlignmentHarness />);
      const callback = Array.from(frames.values())[0];
      const frameId = nextFrame;
      unmount();
      expect(window.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
      act(() => callback(0));
      expect(frames.size).toBe(0);
      expect(scrollTo).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it("aligns an available header synchronously without clearance or retries", () => {
    location.search = "?source=fileSelection";
    const { getByTestId } = render(<AlignmentHarness header />);
    expect(getByTestId("alignment-container").scrollTop).toBe(300);
    expect(frames.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("prefers the scroll root and stabilizes six frames before replacing only the section parameter", () => {
    location.search = "?sidebarSection=theme&keep=yes";
    const { getByTestId } = render(<AlignmentHarness header section root />);
    const container = getByTestId("alignment-container");
    expect(scrollTo).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 6; index += 1) {
      advanceFrame();
      expect(navigate).not.toHaveBeenCalled();
    }
    expect(container.scrollTop).toBe(448);
    advanceFrame();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/settings", search: "?keep=yes" },
      { replace: true },
    );
    expect(frames.size).toBe(0);
  });

  it("uses toggle clearance without a sticky header and retains the one-pixel no-scroll threshold", () => {
    location.search = "?sidebarSection=theme";
    const { getByTestId } = render(<AlignmentHarness section />);
    const container = getByTestId("alignment-container");
    expect(container.scrollTop).toBe(308);
    container.scrollTop = 307;
    scrollTo.mockClear();
    advanceFrame();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("cancels stabilization on navigation without clearing the old request", () => {
    location.search = "?sidebarSection=theme";
    const { rerender } = render(<AlignmentHarness section />);
    advanceFrame();
    const callback = Array.from(frames.values())[0];
    const frameId = nextFrame;
    location = { ...location, pathname: "/other", search: "" };
    rerender(<AlignmentHarness section />);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
    act(() => callback(0));
    expect(frames.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("useSidebarNavigationScroll file selection deep link", () => {
  it("scrolls the sticky source header to the top when source=fileSelection", () => {
    // jsdom returns zeroed rects; model the geometry the hook relies on so the
    // sticky header (300px down) aligns to the container top (scrollTop 300).
    const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const _height = this.getAttribute?.("height") ?? null;
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

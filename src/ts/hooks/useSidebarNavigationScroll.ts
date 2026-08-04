import { useCallback, useLayoutEffect, useRef } from "react";
import type React from "react";
import { useLocation, useNavigate } from "react-router-dom";

let hasInitializedSidebarScroll = false;
let lastSidebarScrollTop = 0;

const EXTRA_CLEARANCE_PX = 12;

const scrollContainerTo = (
  container: HTMLDivElement,
  options: ScrollToOptions,
) => {
  if (typeof container.scrollTo === "function") {
    container.scrollTo(options);
  } else {
    container.scrollTop = options.top ?? container.scrollTop;
  }
};

const getActivePathMatch = (tabPath: string | null, path: string) => {
  return (
    tabPath === path ||
    (tabPath === "/" && (path === "/" || path === "/visualizer"))
  );
};

const getRequiredTopClearance = (
  container: HTMLDivElement,
  stickyToggle: HTMLElement | null,
) => {
  const containerRect = container.getBoundingClientRect();
  if (!stickyToggle) {
    return EXTRA_CLEARANCE_PX;
  }

  const stickyRect = stickyToggle.getBoundingClientRect();
  return Math.max(
    EXTRA_CLEARANCE_PX,
    stickyRect.bottom - containerRect.top + EXTRA_CLEARANCE_PX,
  );
};

const getSidebarStickyClearanceAnchor = (
  container: HTMLDivElement,
): HTMLElement | null => {
  return container.querySelector<HTMLElement>("[data-sidebar-sticky-header]");
};

const getScrollTopForTab = (
  container: HTMLDivElement,
  tabElement: HTMLElement,
  stickyToggle: HTMLElement | null,
) => {
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabElement.getBoundingClientRect();
  const targetTop = getRequiredTopClearance(container, stickyToggle);

  return Math.max(
    0,
    container.scrollTop + (tabRect.top - containerRect.top) - targetTop,
  );
};

const isTabFullyVisible = (
  container: HTMLDivElement,
  tabElement: HTMLElement,
  stickyToggle: HTMLElement | null,
) => {
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabElement.getBoundingClientRect();
  const visibleTop =
    containerRect.top + getRequiredTopClearance(container, stickyToggle);
  const visibleBottom = containerRect.bottom - EXTRA_CLEARANCE_PX;

  return tabRect.top >= visibleTop && tabRect.bottom <= visibleBottom;
};

interface UseSidebarNavigationScrollArgs {
  path: string;
}

interface UseSidebarNavigationScrollReturn {
  navigationContainerRef: React.RefObject<HTMLDivElement | null>;
  sidebarToggleRef: React.RefObject<HTMLButtonElement | null>;
  handleTabClick: (
    tabPath: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}

export const useSidebarNavigationScroll = ({
  path,
}: UseSidebarNavigationScrollArgs): UseSidebarNavigationScrollReturn => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationContainerRef = useRef<HTMLDivElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarSection = new URLSearchParams(location.search).get(
    "sidebarSection",
  );
  const sourceParam = new URLSearchParams(location.search).get("source");
  const fileSelectionDeepLink = sourceParam === "fileSelection";

  useLayoutEffect(() => {
    const container = navigationContainerRef.current;
    if (!container) return;

    const hasSidebarSection = new URLSearchParams(location.search).get(
      "sidebarSection",
    );
    if (hasInitializedSidebarScroll && !hasSidebarSection) {
      container.scrollTop = lastSidebarScrollTop;
    }

    const handleScroll = () => {
      lastSidebarScrollTop = container.scrollTop;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      lastSidebarScrollTop = container.scrollTop;
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const container = navigationContainerRef.current;
    if (!container || sidebarSection || fileSelectionDeepLink) return;

    if (hasInitializedSidebarScroll) {
      container.scrollTop = lastSidebarScrollTop;
    }

    const tabs = container.querySelectorAll("button[data-path]");
    const activeTab = Array.from(tabs).find((tab) =>
      getActivePathMatch(tab.getAttribute("data-path"), path),
    );

    if (!activeTab) return;

    const tabElement = activeTab as HTMLElement;
    const scrollTop = getScrollTopForTab(
      container,
      tabElement,
      sidebarToggleRef.current,
    );

    scrollContainerTo(container, {
      top: scrollTop,
      behavior: hasInitializedSidebarScroll ? "smooth" : "auto",
    });

    lastSidebarScrollTop = scrollTop;
    hasInitializedSidebarScroll = true;

    const frameId = window.requestAnimationFrame(() => {
      if (!navigationContainerRef.current) return;
      if (
        !isTabFullyVisible(
          navigationContainerRef.current,
          tabElement,
          sidebarToggleRef.current,
        )
      ) {
        const correctedScrollTop = getScrollTopForTab(
          navigationContainerRef.current,
          tabElement,
          sidebarToggleRef.current,
        );
        scrollContainerTo(navigationContainerRef.current, {
          top: correctedScrollTop,
          behavior: "auto",
        });
        lastSidebarScrollTop = correctedScrollTop;
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [path]);

  useLayoutEffect(() => {
    const container = navigationContainerRef.current;
    if (!container || !fileSelectionDeepLink) return;

    // Pin the source section's sticky header to the top of the sidebar so the
    // compact File Selection row stays visible. Retry over a few frames because
    // the sidebar content (and the sticky source header) may not be laid out
    // yet on first mount.
    let cancelled = false;
    let frameId = 0;
    let retryAttempts = 0;
    const maxRetryAttempts = 60;

    const findStickyHeader = () =>
      container.querySelector<HTMLElement>("[data-sidebar-sticky-header]");

    const alignStickyHeader = () => {
      const currentContainer = navigationContainerRef.current;
      const header = findStickyHeader();
      if (!currentContainer || !header) return;

      const containerRect = currentContainer.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const scrollTop = Math.max(
        0,
        currentContainer.scrollTop + (headerRect.top - containerRect.top),
      );

      if (Math.abs(currentContainer.scrollTop - scrollTop) > 1) {
        scrollContainerTo(currentContainer, { top: scrollTop, behavior: "auto" });
      }
      lastSidebarScrollTop = scrollTop;
      hasInitializedSidebarScroll = true;
    };

    const waitForHeaderThenAlign = () => {
      if (cancelled) return;
      if (findStickyHeader()) {
        alignStickyHeader();
        return;
      }
      retryAttempts += 1;
      if (retryAttempts >= maxRetryAttempts) return;
      frameId = window.requestAnimationFrame(waitForHeaderThenAlign);
    };

    waitForHeaderThenAlign();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [fileSelectionDeepLink]);

  useLayoutEffect(() => {
    const container = navigationContainerRef.current;
    if (!container || !sidebarSection) return;

    const findSectionElement = () => {
      const currentContainer = navigationContainerRef.current;
      if (!currentContainer) return null;

      const scrollRoot = Array.from(
        currentContainer.querySelectorAll<HTMLElement>(
          "[data-sidebar-scroll-root]",
        ),
      ).find(
        (element) =>
          element.getAttribute("data-sidebar-scroll-root") === sidebarSection,
      );
      if (scrollRoot) return scrollRoot;

      return (
        Array.from(
          currentContainer.querySelectorAll<HTMLElement>(
            "[data-sidebar-section]",
          ),
        ).find(
          (element) =>
            element.getAttribute("data-sidebar-section") === sidebarSection,
        ) ?? null
      );
    };

    let cancelled = false;
    let frameId = 0;
    let retryAttempts = 0;
    const maxRetryAttempts = 60;

    const getClearanceAnchor = (currentContainer: HTMLDivElement) =>
      getSidebarStickyClearanceAnchor(currentContainer) ??
      sidebarToggleRef.current;

    const alignSection = (sectionElement: HTMLElement) => {
      const currentContainer = navigationContainerRef.current;
      if (!currentContainer) return;

      const scrollTop = getScrollTopForTab(
        currentContainer,
        sectionElement,
        getClearanceAnchor(currentContainer),
      );

      if (Math.abs(currentContainer.scrollTop - scrollTop) > 1) {
        scrollContainerTo(currentContainer, { top: scrollTop, behavior: "auto" });
      }
      lastSidebarScrollTop = scrollTop;
      hasInitializedSidebarScroll = true;
    };

    const clearSidebarSectionParam = () => {
      const params = new URLSearchParams(location.search);
      if (!params.has("sidebarSection")) return;
      params.delete("sidebarSection");
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : "",
        },
        { replace: true },
      );
    };

    const runSectionAlignment = (sectionElement: HTMLElement) => {
      alignSection(sectionElement);

      // The sticky source header can change height as this scroll begins. Re-run
      // the alignment for a few frames so the requested section remains the
      // anchor after the source list collapses to its active row.
      let remainingFrames = 6;
      const stabilizeAlignment = () => {
        if (cancelled) return;
        if (remainingFrames <= 0) {
          clearSidebarSectionParam();
          return;
        }
        remainingFrames -= 1;
        alignSection(sectionElement);
        frameId = window.requestAnimationFrame(stabilizeAlignment);
      };
      frameId = window.requestAnimationFrame(stabilizeAlignment);
    };

    const waitForSectionThenAlign = () => {
      if (cancelled) return;

      const sectionElement = findSectionElement();
      if (sectionElement) {
        runSectionAlignment(sectionElement);
        return;
      }

      retryAttempts += 1;
      if (retryAttempts >= maxRetryAttempts) return;
      frameId = window.requestAnimationFrame(waitForSectionThenAlign);
    };

    waitForSectionThenAlign();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [location.pathname, location.search, navigate, path, sidebarSection]);

  const handleTabClick = useCallback(
    (tabPath: string, event: React.MouseEvent<HTMLButtonElement>) => {
      const container = navigationContainerRef.current;
      if (container) {
        const scrollTop = getScrollTopForTab(
          container,
          event.currentTarget,
          sidebarToggleRef.current,
        );
        scrollContainerTo(container, { top: scrollTop, behavior: "smooth" });
        lastSidebarScrollTop = scrollTop;
      }

      if (tabPath === path) return;

      navigate(tabPath);
    },
    [navigate, path],
  );

  return {
    navigationContainerRef,
    sidebarToggleRef,
    handleTabClick,
  };
};

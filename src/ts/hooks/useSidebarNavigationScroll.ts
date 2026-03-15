import { useCallback, useLayoutEffect, useRef } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";

let hasInitializedSidebarScroll = false;
let lastSidebarScrollTop = 0;

const EXTRA_CLEARANCE_PX = 12;

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
  const visibleTop = containerRect.top + getRequiredTopClearance(container, stickyToggle);
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
  const navigate = useNavigate();
  const navigationContainerRef = useRef<HTMLDivElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const container = navigationContainerRef.current;
    if (!container) return;

    if (hasInitializedSidebarScroll) {
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
    if (!container) return;

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

    container.scrollTo({
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
        navigationContainerRef.current.scrollTo({
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

  const handleTabClick = useCallback(
    (tabPath: string, event: React.MouseEvent<HTMLButtonElement>) => {
      const container = navigationContainerRef.current;
      if (container) {
        const scrollTop = getScrollTopForTab(
          container,
          event.currentTarget,
          sidebarToggleRef.current,
        );
        container.scrollTo({ top: scrollTop, behavior: "smooth" });
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

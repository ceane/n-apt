import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";

const STICKY_HEADER_CLEARANCE_PX = 12;

interface UseSettingsSectionScrollSpyArgs {
  containerRef: React.RefObject<HTMLElement | null>;
  sectionIds: string[];
}

interface UseSettingsSectionScrollSpyReturn {
  activeSectionId: string | null;
  scrollToSection: (sectionId: string) => void;
}

const getSectionId = (element: Element): string | null =>
  element.getAttribute("data-settings-section");

/**
 * Tracks which content section is currently in view inside a scrollable
 * container and exposes a scroll-to helper for sidebar section links.
 */
export const useSettingsSectionScrollSpy = ({
  containerRef,
  sectionIds,
}: UseSettingsSectionScrollSpyArgs): UseSettingsSectionScrollSpyReturn => {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    sectionIds[0] ?? null,
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sectionIdsRef = useRef(sectionIds);
  // Re-render (and re-run the observer effect) when the container element
  // becomes available. The container may be mounted lazily after this hook
  // runs (e.g. a lazy route populating a ref owned by the shell), so watching
  // the ref identity alone would never re-connect the observer.
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    sectionIdsRef.current = sectionIds;
  }, [sectionIds]);

  // Pick up the container whenever this component re-renders (fast path).
  useLayoutEffect(() => {
    setContainer(containerRef.current);
  });

  // While the container is still null, poll for it so a lazily mounted route
  // that populates the ref is detected even though this component (e.g. the
  // app shell) never re-renders when that route resolves.
  useEffect(() => {
    if (container) return;
    const pollId = window.setInterval(() => {
      if (containerRef.current) {
        setContainer(containerRef.current);
      }
    }, 100);
    return () => window.clearInterval(pollId);
  }, [container, containerRef]);

  useEffect(() => {
    if (!container || typeof IntersectionObserver === "undefined") return;

    const visibleSections = new Map<string, number>();

    const resolveActive = () => {
      let bestId: string | null = null;
      let bestRatio = 0;
      for (const [id, ratio] of visibleSections) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      if (bestId) setActiveSectionId(bestId);
    };

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = getSectionId(entry.target);
          if (!id) continue;
          if (entry.isIntersecting) {
            visibleSections.set(id, entry.intersectionRatio);
          } else {
            visibleSections.delete(id);
          }
        }
        resolveActive();
      },
      {
        root: container,
        rootMargin: `-${STICKY_HEADER_CLEARANCE_PX}px 0px -25% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    const observeSections = () => {
      for (const id of sectionIdsRef.current) {
        const element = container.querySelector<HTMLElement>(
          `[data-settings-section="${id}"]`,
        );
        if (element) observerRef.current?.observe(element);
      }
    };

    // Observe any sections already in the DOM, then re-observe on a microtask
    // in case a lazy route mounted them just after this effect ran. Also watch
    // for the container gaining the sections later (e.g. the settings route
    // mounting after the shell).
    observeSections();
    const retry = window.setTimeout(observeSections, 0);
    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => observeSections())
        : null;
    mutationObserver?.observe(container, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(retry);
      mutationObserver?.disconnect();
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [container]);

  const scrollToSection = useCallback(
    (sectionId: string) => {
      const container = containerRef.current;
      if (!container) return;

      const element = container.querySelector<HTMLElement>(
        `[data-settings-section="${sectionId}"]`,
      );
      if (!element) return;

      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const targetTop =
        container.scrollTop +
        (elementRect.top - containerRect.top) -
        STICKY_HEADER_CLEARANCE_PX;

      container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
      setActiveSectionId(sectionId);
    },
    [containerRef],
  );

  return { activeSectionId, scrollToSection };
};

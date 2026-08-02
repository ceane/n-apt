import { useCallback, useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    sectionIdsRef.current = sectionIds;
  }, [sectionIds]);

  useEffect(() => {
    const container = containerRef.current;
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

    for (const id of sectionIdsRef.current) {
      const element = container.querySelector<HTMLElement>(
        `[data-settings-section="${id}"]`,
      );
      if (element) observerRef.current.observe(element);
    }

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [containerRef]);

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

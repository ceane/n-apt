import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useSettingsSectionScrollSpy } from "@n-apt/settings/hooks/useSettingsSectionScrollSpy";

type ObserverEntry = {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
};
type ObserverCallback = (entries: ObserverEntry[]) => void;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: ObserverCallback;
  observed: Element[] = [];

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}
  disconnect() {}

  fire(entries: ObserverEntry[]) {
    this.callback(entries);
  }
}

const SECTION_IDS = [
  "theme",
  "sdr",
  "login",
  "iq-capture",
  "snapshot",
  "extras",
];

const buildContainer = (): HTMLDivElement => {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  for (const id of SECTION_IDS) {
    const section = document.createElement("section");
    section.dataset.settingsSection = id;
    section.id = id;
    container.appendChild(section);
  }
  document.body.appendChild(container);
  return container;
};

describe("useSettingsSectionScrollSpy", () => {
  let originalObserver: typeof IntersectionObserver;

  beforeAll(() => {
    originalObserver = globalThis.IntersectionObserver;
    (globalThis as any).IntersectionObserver = MockIntersectionObserver;
  });

  afterAll(() => {
    (globalThis as any).IntersectionObserver = originalObserver;
  });

  afterEach(() => {
    MockIntersectionObserver.instances = [];
    document.body.innerHTML = "";
  });

  it("starts with the first section active", () => {
    const containerRef = createRef<HTMLDivElement>();
    (containerRef as any).current = buildContainer();

    const { result } = renderHook(() =>
      useSettingsSectionScrollSpy({ containerRef, sectionIds: SECTION_IDS }),
    );

    expect(result.current.activeSectionId).toBe("theme");
  });

  it("jumps to a requested section after a legacy route redirect", () => {
    const containerRef = createRef<HTMLDivElement>();
    const container = buildContainer();
    (containerRef as any).current = container;
    container.scrollTo = jest.fn();

    const { result } = renderHook(() =>
      useSettingsSectionScrollSpy({
        containerRef,
        sectionIds: SECTION_IDS,
        requestedSectionId: "extras",
      }),
    );

    expect(result.current.activeSectionId).toBe("extras");
    expect(container.scrollTo).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: "smooth",
    });
  });

  it("updates active section when an observed section enters view", () => {
    const containerRef = createRef<HTMLDivElement>();
    const container = buildContainer();
    (containerRef as any).current = container;

    const { result } = renderHook(() =>
      useSettingsSectionScrollSpy({ containerRef, sectionIds: SECTION_IDS }),
    );

    const observer = MockIntersectionObserver.instances[0];
    const loginSection = container.querySelector(
      '[data-settings-section="login"]',
    )!;
    const themeSection = container.querySelector(
      '[data-settings-section="theme"]',
    )!;

    act(() => {
      observer.fire([
        { target: themeSection, isIntersecting: false, intersectionRatio: 0 },
        { target: loginSection, isIntersecting: true, intersectionRatio: 0.5 },
      ]);
    });

    expect(result.current.activeSectionId).toBe("login");
  });

  it("reconnects the observer when the container mounts after the hook", () => {
    // Simulates the shell mounting first (containerRef.current is null) and a
    // lazy route populating the container afterwards — the previous behavior
    // created the observer once with a null root and never re-ran.
    jest.useFakeTimers();
    try {
      const containerRef = createRef<HTMLDivElement>();
      (containerRef as any).current = null;

      renderHook(() =>
        useSettingsSectionScrollSpy({
          containerRef,
          sectionIds: SECTION_IDS,
        }),
      );

      expect(MockIntersectionObserver.instances).toHaveLength(0);

      const container = buildContainer();
      (containerRef as any).current = container;

      act(() => {
        jest.advanceTimersByTime(200);
      });

      const observers = MockIntersectionObserver.instances;
      const observer = observers[observers.length - 1];
      expect(observer.observed).toHaveLength(SECTION_IDS.length);
      expect(observer.observed.map((el) => el.id)).toEqual(SECTION_IDS);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    { scrollTop: 80, containerTop: 100, elementTop: 350, expected: 318 },
    { scrollTop: 0, containerTop: 100, elementTop: 105, expected: 0 },
  ])(
    "uses container-relative geometry with 12px clearance: $expected",
    ({ scrollTop, containerTop, elementTop, expected }) => {
      const container = buildContainer();
      const element = container.querySelector<HTMLElement>(
        '[data-settings-section="snapshot"]',
      )!;
      container.scrollTop = scrollTop;
      container.getBoundingClientRect = () =>
        ({ top: containerTop }) as DOMRect;
      element.getBoundingClientRect = () => ({ top: elementTop }) as DOMRect;
      container.scrollTo = jest.fn();
      const { result } = renderHook(() =>
        useSettingsSectionScrollSpy({
          containerRef: { current: container },
          sectionIds: SECTION_IDS,
        }),
      );
      act(() => result.current.scrollToSection("snapshot"));
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(container.scrollTo).toHaveBeenCalledWith({
        top: expected,
        behavior: "smooth",
      });
      expect(result.current.activeSectionId).toBe("snapshot");
    },
  );

  it("does not scroll or change active state for a missing section", () => {
    const container = buildContainer();
    container.scrollTo = jest.fn();
    const { result } = renderHook(() =>
      useSettingsSectionScrollSpy({
        containerRef: { current: container },
        sectionIds: SECTION_IDS,
      }),
    );
    act(() => result.current.scrollToSection("missing"));
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(result.current.activeSectionId).toBe("theme");
  });

  it("scrollToSection smooth-scrolls to the section and sets it active", () => {
    const containerRef = createRef<HTMLDivElement>();
    const container = buildContainer();
    (containerRef as any).current = container;
    container.scrollTo = jest.fn();

    const { result } = renderHook(() =>
      useSettingsSectionScrollSpy({ containerRef, sectionIds: SECTION_IDS }),
    );

    act(() => {
      result.current.scrollToSection("snapshot");
    });

    expect(result.current.activeSectionId).toBe("snapshot");
    expect(container.scrollTo).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: "smooth",
    });
  });
});

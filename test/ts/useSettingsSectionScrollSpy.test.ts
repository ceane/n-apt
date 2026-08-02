import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useSettingsSectionScrollSpy } from "@n-apt/hooks/useSettingsSectionScrollSpy";

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

const SECTION_IDS = ["theme", "sdr", "login", "iq-capture", "snapshot"];

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

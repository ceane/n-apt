import {
  getContainerRelativeScrollTop,
  retryAnimationFrame,
} from "@n-apt/ui/scrollAlignment";

describe("retryAnimationFrame", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  const advance = () => {
    const callbacks = Array.from(frames.values());
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    frames = new Map();
    nextId = 0;
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.set(++nextId, callback);
        return nextId;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("tries synchronously and stops immediately on success", () => {
    const attempt = jest.fn(() => true);
    retryAnimationFrame(attempt, 60);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it.each([1, 60])("bounds unsuccessful attempts at %i", (maxAttempts) => {
    const attempt = jest.fn(() => false);
    retryAnimationFrame(attempt, maxAttempts);
    for (let index = 0; index < maxAttempts + 1; index += 1) advance();
    expect(attempt).toHaveBeenCalledTimes(maxAttempts);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(maxAttempts - 1);
    expect(frames.size).toBe(0);
  });

  it("stops scheduling when a later attempt succeeds", () => {
    let attempts = 0;
    retryAnimationFrame(() => ++attempts === 3, 60);
    advance();
    advance();
    expect(attempts).toBe(3);
    expect(frames.size).toBe(0);
  });

  it("cancels the latest retry and guards a stale callback", () => {
    const attempt = jest.fn(() => false);
    const cancel = retryAnimationFrame(attempt, 60);
    advance();
    const callback = Array.from(frames.values())[0];
    cancel();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(2);
    callback(0);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });
});

describe("getContainerRelativeScrollTop", () => {
  it.each([
    { clearance: 0, expected: 330 },
    { clearance: 12, expected: 318 },
    { clearance: 92, expected: 238 },
    { clearance: 400, expected: 0 },
  ])(
    "applies $clearance clearance without scrolling",
    ({ clearance, expected }) => {
      const container = document.createElement("div");
      const element = document.createElement("section");
      container.scrollTop = 80;
      container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
      element.getBoundingClientRect = () => ({ top: 350 }) as DOMRect;
      expect(getContainerRelativeScrollTop(container, element, clearance)).toBe(
        expected,
      );
      expect(container.scrollTop).toBe(80);
    },
  );
});

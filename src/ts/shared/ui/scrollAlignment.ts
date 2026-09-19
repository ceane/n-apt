export const retryAnimationFrame = (
  attempt: () => boolean,
  maxAttempts: number,
): (() => void) => {
  let cancelled = false;
  let frameId = 0;
  let attempts = 0;

  const run = () => {
    if (cancelled) return;
    if (attempt()) return;
    attempts += 1;
    if (attempts >= maxAttempts) return;
    frameId = window.requestAnimationFrame(run);
  };

  run();

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
  };
};

export const getContainerRelativeScrollTop = (
  container: HTMLElement,
  element: HTMLElement,
  clearance: number,
): number => {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return Math.max(
    0,
    container.scrollTop + (elementRect.top - containerRect.top) - clearance,
  );
};

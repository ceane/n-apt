export type FrameArrivalListener = () => void;

const frameArrivalSubscribers = new Set<FrameArrivalListener>();

/** Notify imperative consumers after the latest live frame slot is populated. */
export const notifyFrameArrival = (): void => {
  for (const listener of frameArrivalSubscribers) listener();
};

/** Subscribe to frame arrivals without creating a polling timer. */
export const subscribeFrameArrivals = (
  listener: FrameArrivalListener,
): (() => void) => {
  frameArrivalSubscribers.add(listener);
  return () => {
    frameArrivalSubscribers.delete(listener);
  };
};

export type FrameArrivalListener = () => void;
export type RawIqFrameArrivalListener = (frame: unknown) => void;

const frameArrivalSubscribers = new Set<FrameArrivalListener>();
const rawIqFrameArrivalSubscribers = new Set<RawIqFrameArrivalListener>();

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

/** Publish every receive-side I/Q frame before the presentation layer coalesces frames. */
export const notifyRawIqFrameArrival = (frame: unknown): void => {
  for (const listener of rawIqFrameArrivalSubscribers) {
    try {
      listener(frame);
    } catch {
      // A consumer must not interrupt the receiver's frame-delivery path.
    }
  }
};

/** Subscribe to ordered raw-I/Q arrivals for bounded streaming consumers. */
export const subscribeRawIqFrameArrivals = (
  listener: RawIqFrameArrivalListener,
): (() => void) => {
  rawIqFrameArrivalSubscribers.add(listener);
  return () => {
    rawIqFrameArrivalSubscribers.delete(listener);
  };
};

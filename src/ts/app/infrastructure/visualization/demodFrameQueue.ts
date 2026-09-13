export type DemodFrameQueue<T> = {
  push: (frames: T[]) => void;
  drain: () => T[];
  clear: () => void;
};

export const createDemodFrameQueue = <T>(
  maxFrames = 96,
): DemodFrameQueue<T> => {
  const frames: T[] = [];
  return {
    push(nextFrames) {
      frames.push(...nextFrames);
      if (frames.length > maxFrames)
        frames.splice(0, frames.length - maxFrames);
    },
    drain() {
      return frames.splice(0, frames.length);
    },
    clear() {
      frames.length = 0;
    },
  };
};

export const demodFrameQueue = createDemodFrameQueue<any>();

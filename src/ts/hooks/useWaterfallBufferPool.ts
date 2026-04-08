import { useRef, useCallback } from "react";

export interface WaterfallBufferPoolState {
  waterfallBufferRef: React.MutableRefObject<Uint8ClampedArray | null>;
  waterfallDataWidthRef: React.MutableRefObject<number | null>;
  getBufferFromPool: (size: number) => Uint8ClampedArray;
  returnBufferToPool: (buffer: Uint8ClampedArray) => void;
}

export const useWaterfallBufferPool = (): WaterfallBufferPoolState => {
  const waterfallBufferRef = useRef<Uint8ClampedArray | null>(null);
  const waterfallDataWidthRef = useRef<number | null>(null);
  const bufferPoolRef = useRef<Uint8ClampedArray[]>([]);
  const maxBufferPoolSize = 3;

  const getBufferFromPool = useCallback((size: number): Uint8ClampedArray => {
    const pool = bufferPoolRef.current;
    for (let i = 0; i < pool.length; i++) {
      const buffer = pool[i];
      if (buffer.length === size) {
        pool.splice(i, 1);
        buffer.fill(0);
        return buffer;
      }
    }
    return new Uint8ClampedArray(size);
  }, []);

  const returnBufferToPool = useCallback((buffer: Uint8ClampedArray) => {
    const pool = bufferPoolRef.current;
    if (pool.length < maxBufferPoolSize) {
      pool.push(buffer);
    }
  }, []);

  return {
    waterfallBufferRef,
    waterfallDataWidthRef,
    getBufferFromPool,
    returnBufferToPool,
  };
};

import { useState, useEffect, useCallback } from 'react';
import { liveDataRef } from '@n-apt/redux/middleware/websocketMiddleware';
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";

export interface IQPoint {
  index: number;
  i: number;
  q: number;
  symbol: string;
  phaseDeg: number;
  powerDbm: number;
  hexI: string;
  hexQ: string;
}

export function useFFTPointsGrid(numPoints: number, offset: number = 0) {
  const [isLive, setIsLive] = useState(false);
  const [points, setPoints] = useState<IQPoint[]>([]);
  const { wsConnection, manualVisualizerPaused } = useSpectrumStore();

  const isGlobalPaused = manualVisualizerPaused ?? wsConnection?.isPaused ?? false;

  const onRenderFrame = useCallback(() => {
    const live = liveDataRef.current;
    if (live && live.iq_data && live.iq_data.length > 0) {
      if (!isLive) setIsLive(true);
      const samples = live.iq_data;
      const newPoints: IQPoint[] = [];

      for (let idx = 0; idx < numPoints; idx++) {
        const base = (offset * 2) + (idx * 2);
        const iVal = samples[base] ?? 128;
        const qVal = samples[base + 1] ?? 128;

        const sI = iVal >= 128 ? '+' : '-';
        const sQ = qVal >= 128 ? '+' : '-';

        const phaseRad = Math.atan2(qVal - 128, iVal - 128);
        const phaseDeg = Math.round(((phaseRad * 180) / Math.PI + 360) % 360);

        const magnitude = Math.sqrt(Math.pow((iVal - 128) / 128, 2) + Math.pow((qVal - 128) / 128, 2));
        const powerDbm = -70 + (magnitude * 50);

        newPoints.push({
          index: idx,
          i: iVal,
          q: qVal,
          symbol: `(${sI}, ${sQ})`,
          phaseDeg,
          powerDbm,
          hexI: iVal.toString(16).toUpperCase().padStart(2, '0'),
          hexQ: qVal.toString(16).toUpperCase().padStart(2, '0')
        });
      }
      setPoints(newPoints);
    } else {
      if (isLive) setIsLive(false);
      // Do not generate fake data. Just clear or maintain the last frame.
      if (points.length > 0) {
        setPoints([]);
      }
    }
  }, [numPoints, offset, isLive, points.length]);

  const { animate, forceRender } = useFFTAnimation({
    isPaused: isGlobalPaused,
    onRenderFrame
  });

  useEffect(() => {
    forceRender();
    animate(true);
  }, [animate, forceRender, isGlobalPaused]);

  return { isLive, points };
}

export interface TableViewport {
  width: number;
  height: number;
}

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

export interface VisibleIQSample {
  sampleIndex: number;
  i: number;
  q: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const resolveSampleCount = (
  fallbackFftSize: number,
  liveSampleCount: number,
) => {
  if (Number.isFinite(liveSampleCount) && liveSampleCount > 0) {
    return liveSampleCount;
  }

  return Number.isFinite(fallbackFftSize) && fallbackFftSize > 0
    ? fallbackFftSize
    : 2048;
};

export const computeBitstreamLayout = (viewport: TableViewport) => {
  const width = Math.max(0, viewport.width);
  const height = Math.max(0, viewport.height);
  const addressColumnWidth = width >= 900 ? 128 : 112;
  const gap = width >= 900 ? 12 : 8;
  const availableByteWidth = Math.max(96, width - addressColumnWidth - gap);
  const estimatedByteCellWidth = width >= 900 ? 46 : width >= 700 ? 40 : 34;
  const bytesPerRow = clamp(
    Math.floor(availableByteWidth / estimatedByteCellWidth),
    4,
    16,
  );
  const evenBytesPerRow = bytesPerRow % 2 === 0 ? bytesPerRow : bytesPerRow - 1;
  const rowHeight = width >= 900 ? 32 : 36;
  const rowsCount = Math.max(1, Math.floor((height - 8) / rowHeight));

  return {
    addressColumnWidth,
    gap,
    bytesPerRow: evenBytesPerRow,
    iqPairsPerRow: evenBytesPerRow / 2,
    rowHeight,
    rowsCount,
  };
};

export const computeSymbolsLayout = (viewport: TableViewport) => {
  const width = Math.max(0, viewport.width);
  const height = Math.max(0, viewport.height);
  const rowHeight = width >= 900 ? 28 : 32;

  return {
    rowHeight,
    rowsCount: Math.max(1, Math.floor((height - 8) / rowHeight)),
  };
};

export const deriveIQPoints = (
  iqData: Uint8Array | undefined,
  numPoints: number,
  offset: number = 0,
): IQPoint[] => {
  if (!iqData || iqData.length === 0 || numPoints <= 0) {
    return [];
  }

  const points: IQPoint[] = [];

  for (let idx = 0; idx < numPoints; idx += 1) {
    const base = (offset * 2) + (idx * 2);
    const iVal = iqData[base];
    const qVal = iqData[base + 1];

    if (typeof iVal !== "number" || typeof qVal !== "number") {
      break;
    }

    const sI = iVal >= 128 ? "+" : "-";
    const sQ = qVal >= 128 ? "+" : "-";
    const phaseRad = Math.atan2(qVal - 128, iVal - 128);
    const phaseDeg = Math.round(((phaseRad * 180) / Math.PI + 360) % 360);
    const magnitude = Math.sqrt(
      Math.pow((iVal - 128) / 128, 2) + Math.pow((qVal - 128) / 128, 2),
    );
    const powerDbm = -70 + (magnitude * 50);

    points.push({
      index: idx,
      i: iVal,
      q: qVal,
      symbol: `(${sI}, ${sQ})`,
      phaseDeg,
      powerDbm,
      hexI: iVal.toString(16).toUpperCase().padStart(2, "0"),
      hexQ: qVal.toString(16).toUpperCase().padStart(2, "0"),
    });
  }

  return points;
};

export const getIqDataView = (
  iqData: Uint8Array | undefined,
): DataView | null => {
  if (!iqData || iqData.length < 2) {
    return null;
  }

  return new DataView(iqData.buffer, iqData.byteOffset, iqData.byteLength);
};

export const resolveAvailableSampleCount = (
  iqData: Uint8Array | undefined,
  fallbackFftSize: number,
): number => {
  const liveSampleCount = iqData ? Math.floor(iqData.length / 2) : 0;
  return resolveSampleCount(fallbackFftSize, liveSampleCount);
};

export const readVisibleIQSample = (
  view: DataView | null,
  sampleIndex: number,
): VisibleIQSample | null => {
  if (!view || sampleIndex < 0) {
    return null;
  }

  const byteOffset = sampleIndex * 2;
  if (byteOffset + 1 >= view.byteLength) {
    return null;
  }

  return {
    sampleIndex,
    i: view.getUint8(byteOffset),
    q: view.getUint8(byteOffset + 1),
  };
};

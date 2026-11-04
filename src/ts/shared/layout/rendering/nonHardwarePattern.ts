export type PatternBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DiagonalStripeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type PatternPoint = { x: number; y: number };

export const NON_HARDWARE_PATTERN_STROKE = "#c25100";
export const NON_HARDWARE_PATTERN_LINE_WIDTH = 8;
export const NON_HARDWARE_PATTERN_OPACITY = 0.1862;
export const NON_HARDWARE_PATTERN_BORDER_PADDING =
  NON_HARDWARE_PATTERN_LINE_WIDTH / 2;
export const NON_HARDWARE_PATTERN_SPACING = 22;

export type PatternSourceIdentity = {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
};

const normalizeSourceIdentity = (value?: string | null) =>
  value?.toLowerCase().replace(/_/g, "-") ?? "";

export const isMockTxIdentity = ({
  deviceKind,
  backend,
  deviceName,
}: PatternSourceIdentity): boolean =>
  normalizeSourceIdentity(deviceKind) === "mock-tx" ||
  normalizeSourceIdentity(backend) === "mock-tx" ||
  deviceName?.toLowerCase().includes("mock tx") === true;

export const isMockAptIdentity = ({
  deviceKind,
  backend,
  deviceName,
}: PatternSourceIdentity): boolean =>
  normalizeSourceIdentity(deviceKind) === "mock-apt" ||
  normalizeSourceIdentity(backend) === "mock-apt" ||
  deviceName?.toLowerCase().includes("mock apt") === true;

export const shouldApplyNonHardwareSourcePattern = ({
  enabled = true,
  deviceKind,
  backend,
  deviceName,
  isNonHardwareSource = false,
}: PatternSourceIdentity & {
  enabled?: boolean;
  isNonHardwareSource?: boolean;
}): boolean =>
  enabled &&
  (isNonHardwareSource ||
    isMockAptIdentity({ deviceKind, backend, deviceName }) ||
    isMockTxIdentity({ deviceKind, backend, deviceName }));

export type PatternStrokeStyle = {
  blendMode?: GlobalCompositeOperation;
  opacity?: number;
};

function getOverdrawnStripeSegments(
  bounds: PatternBounds,
): DiagonalStripeSegment[] {
  const overdraw = NON_HARDWARE_PATTERN_LINE_WIDTH;
  return getDiagonalStripeSegments(bounds).map((segment) => {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) return segment;

    const extendX = (dx / length) * overdraw;
    const extendY = (dy / length) * overdraw;
    return {
      x1: segment.x1 - extendX,
      y1: segment.y1 - extendY,
      x2: segment.x2 + extendX,
      y2: segment.y2 + extendY,
    };
  });
}

export function getSpectrumFillPolygon({
  bounds,
  waveform,
  dbMin,
  dbMax,
}: {
  bounds: PatternBounds;
  waveform: Float32Array | null | undefined;
  dbMin: number;
  dbMax: number;
}): PatternPoint[] {
  if (
    !waveform?.length ||
    !Number.isFinite(dbMin) ||
    !Number.isFinite(dbMax) ||
    dbMax <= dbMin ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return [];
  }

  const plotBottom = bounds.y + bounds.height;
  const dbSpan = dbMax - dbMin;
  const lastSample = waveform.length - 1;
  const polygon: PatternPoint[] = [{ x: bounds.x, y: plotBottom }];

  for (let index = 0; index <= lastSample; index += 1) {
    const sample = waveform[index];
    const normalized = Number.isFinite(sample)
      ? Math.min(1, Math.max(0, (sample - dbMin) / dbSpan))
      : 0;
    polygon.push({
      x:
        bounds.x + (lastSample === 0 ? 0 : (index / lastSample) * bounds.width),
      y: Math.max(
        bounds.y,
        plotBottom -
          normalized * bounds.height -
          NON_HARDWARE_PATTERN_BORDER_PADDING,
      ),
    });
  }

  polygon.push({ x: bounds.x + bounds.width, y: plotBottom });
  return polygon;
}

export function getDiagonalStripeSegments(
  { x, y, width, height }: PatternBounds,
  spacing = NON_HARDWARE_PATTERN_SPACING,
): DiagonalStripeSegment[] {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(spacing) ||
    spacing <= 0
  ) {
    return [];
  }

  const segments: DiagonalStripeSegment[] = [];
  const right = x + width;
  const bottom = y + height;

  // Each line follows x - y = offset, which gives a 45-degree downward
  // diagonal. Anchor the phase at the top-left so it cannot leave a short
  // uncovered strip there when the plot height is not divisible by spacing.
  const firstOffset = Math.ceil(-height / spacing) * spacing;
  for (let offset = firstOffset; offset < width; offset += spacing) {
    const intersections = [
      { x: x + offset, y },
      { x: x + offset + height, y: bottom },
      { x, y: y - offset },
      { x: right, y: y + width - offset },
    ].filter(
      (point) =>
        point.x >= x - 1e-6 &&
        point.x <= right + 1e-6 &&
        point.y >= y - 1e-6 &&
        point.y <= bottom + 1e-6,
    );

    const uniquePoints = intersections.filter(
      (point, index) =>
        intersections.findIndex(
          (candidate) =>
            Math.abs(candidate.x - point.x) < 1e-6 &&
            Math.abs(candidate.y - point.y) < 1e-6,
        ) === index,
    );
    if (uniquePoints.length < 2) continue;

    const [start, end] = uniquePoints;
    segments.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
  }

  return segments;
}

type StripeCanvasContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "rect"
  | "closePath"
  | "clip"
> & {
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  lineWidth: number;
  globalCompositeOperation: GlobalCompositeOperation;
  globalAlpha: number;
};

export function drawDiagonalStripePatternOnCanvas(
  context: StripeCanvasContext,
  bounds: PatternBounds,
  clipPolygon?: PatternPoint[],
): void {
  const segments = getOverdrawnStripeSegments(bounds);
  if (segments.length === 0) return;

  context.save();
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.clip();
  if (clipPolygon && clipPolygon.length >= 3) {
    context.beginPath();
    context.moveTo(clipPolygon[0].x, clipPolygon[0].y);
    for (const point of clipPolygon.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.clip();
  }
  context.strokeStyle = NON_HARDWARE_PATTERN_STROKE;
  context.lineWidth = NON_HARDWARE_PATTERN_LINE_WIDTH;
  context.globalCompositeOperation = "difference";
  context.globalAlpha = NON_HARDWARE_PATTERN_OPACITY;
  context.beginPath();
  for (const { x1, y1, x2, y2 } of segments) {
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
  }
  context.stroke();
  context.restore();
}

export type StripeDrawingContext = {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  setStroke(color: string, width: number, style?: PatternStrokeStyle): void;
  clipPolygon(points: PatternPoint[]): void;
};

export function drawDiagonalStripePattern(
  context: StripeDrawingContext,
  bounds: PatternBounds,
  clipPolygon?: PatternPoint[],
): void {
  const segments = getOverdrawnStripeSegments(bounds);
  if (segments.length === 0) return;

  context.save();
  context.clipPolygon([
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ]);
  if (clipPolygon?.length) {
    context.clipPolygon(clipPolygon);
  }
  context.setStroke(
    NON_HARDWARE_PATTERN_STROKE,
    NON_HARDWARE_PATTERN_LINE_WIDTH,
    {
      blendMode: "difference",
      opacity: NON_HARDWARE_PATTERN_OPACITY,
    },
  );
  context.beginPath();
  for (const { x1, y1, x2, y2 } of segments) {
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
  }
  context.stroke();
  context.restore();
}

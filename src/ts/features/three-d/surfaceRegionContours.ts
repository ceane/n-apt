export type SurfacePoint = [number, number, number];

export function createSurfaceEllipseContour(
  center: SurfacePoint,
  surfaceNormal: SurfacePoint,
  halfWidth: number,
  halfHeight: number,
  segments = 28,
): SurfacePoint[] {
  const normalLength = Math.hypot(...surfaceNormal);
  const normal: SurfacePoint = normalLength > 1e-8
    ? surfaceNormal.map((component) => component / normalLength) as SurfacePoint
    : [0, 0, 1];
  let vertical: SurfacePoint = [-normal[0] * normal[1], 1 - normal[1] ** 2, -normal[2] * normal[1]];
  let verticalLength = Math.hypot(...vertical);
  if (verticalLength < 1e-8) {
    vertical = [0, 0, 1];
    verticalLength = 1;
  }
  vertical = vertical.map((component) => component / verticalLength) as SurfacePoint;
  const across: SurfacePoint = [
    normal[1] * vertical[2] - normal[2] * vertical[1],
    normal[2] * vertical[0] - normal[0] * vertical[2],
    normal[0] * vertical[1] - normal[1] * vertical[0],
  ];

  return Array.from({ length: segments }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    const widthOffset = Math.cos(angle) * halfWidth;
    const heightOffset = Math.sin(angle) * halfHeight;
    return [
      center[0] + across[0] * widthOffset + vertical[0] * heightOffset,
      center[1] + across[1] * widthOffset + vertical[1] * heightOffset,
      center[2] + across[2] * widthOffset + vertical[2] * heightOffset,
    ];
  });
}

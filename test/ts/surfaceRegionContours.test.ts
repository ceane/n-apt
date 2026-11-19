import { createSurfaceEllipseContour } from '@n-apt/three-d/surfaceRegionContours';

describe('surface region contours', () => {
  test('keeps an ear contour local to the projected surface anchor', () => {
    const center: [number, number, number] = [0.5, 1.8, 0.12];
    const contour = createSurfaceEllipseContour(center, [1, 0, 0], 0.02, 0.045);

    expect(contour).toHaveLength(28);
    contour.forEach(([x, y, z]) => {
      expect(Math.abs(x - center[0])).toBeLessThan(0.001);
      expect(Math.abs(y - center[1])).toBeLessThanOrEqual(0.045);
      expect(Math.abs(z - center[2])).toBeLessThan(0.020001);
    });
  });
});

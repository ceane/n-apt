import { rotationMarkerArrowHead, rotationMarkerOrbits } from '@n-apt/three-d/rotationMarkerGeometry';

describe('rotation marker arrowhead geometry', () => {
  test('uses equal-sized circular orbits on perpendicular planes', () => {
    const [frontOrbit, sideOrbit] = rotationMarkerOrbits(0.035);
    const frontNormal = [0, 0, 1];
    const sideNormal = [0, -Math.sin(sideOrbit.rotation[0]), Math.cos(sideOrbit.rotation[0])];

    expect(frontOrbit.radius).toBe(sideOrbit.radius);
    expect(frontOrbit.arc).toBe(sideOrbit.arc);
    expect(frontOrbit.arc).toBeLessThan(Math.PI * 2);
    expect(frontOrbit.arc).toBeLessThan(Math.PI * 1.7);
    expect(frontOrbit.tubeRadius).toBe(sideOrbit.tubeRadius);
    expect(frontOrbit.scale).toEqual([1, 1, 1]);
    expect(sideOrbit.scale).toEqual([1, 1, 1]);
    expect(frontNormal[0] * sideNormal[0] + frontNormal[1] * sideNormal[1] + frontNormal[2] * sideNormal[2]).toBeCloseTo(0);
    expect(Math.hypot(frontOrbit.offset[0] - sideOrbit.offset[0], frontOrbit.offset[1] - sideOrbit.offset[1], frontOrbit.offset[2] - sideOrbit.offset[2])).toBeCloseTo(frontOrbit.radius * 0.5);

    let minimumCenterlineDistance = Number.POSITIVE_INFINITY;
    const samples = 256;
    for (let frontIndex = 0; frontIndex <= samples; frontIndex += 1) {
      const frontAngle = frontOrbit.arc * frontIndex / samples;
      const frontPoint = [
        frontOrbit.offset[0] + frontOrbit.radius * Math.cos(frontAngle),
        frontOrbit.offset[1] + frontOrbit.radius * Math.sin(frontAngle),
        frontOrbit.offset[2],
      ];
      for (let sideIndex = 0; sideIndex < samples; sideIndex += 1) {
        const sideAngle = sideOrbit.arc * sideIndex / samples;
        const sidePoint = [
          sideOrbit.offset[0] + sideOrbit.radius * Math.cos(sideAngle),
          sideOrbit.offset[1],
          sideOrbit.offset[2] + sideOrbit.radius * Math.sin(sideAngle),
        ];
        minimumCenterlineDistance = Math.min(minimumCenterlineDistance, Math.hypot(
          frontPoint[0] - sidePoint[0],
          frontPoint[1] - sidePoint[1],
          frontPoint[2] - sidePoint[2],
        ));
      }
    }
    expect(minimumCenterlineDistance).toBeGreaterThan(frontOrbit.tubeRadius + sideOrbit.tubeRadius);
  });

  test('starts at the open end of the orbit and points forward along its tangent', () => {
    const radius = 0.035;
    const angle = rotationMarkerOrbits(radius)[0].arc;
    const arrowHead = rotationMarkerArrowHead(radius, angle);
    const tangent = [-Math.sin(angle), Math.cos(angle)];
    const base = [
      arrowHead.position[0] - tangent[0] * arrowHead.height / 2,
      arrowHead.position[1] - tangent[1] * arrowHead.height / 2,
    ];

    expect(base[0]).toBeCloseTo(radius * Math.cos(angle));
    expect(base[1]).toBeCloseTo(radius * Math.sin(angle));
    expect(arrowHead.radius).toBeLessThan(radius * 0.25);
    expect(arrowHead.rotationZ).toBeCloseTo(Math.atan2(tangent[1], tangent[0]) - Math.PI / 2);
  });
});

import { SphereGeometry, Vector3 } from "three";

/** Creates a softly lobed volume for brain-region highlights. */
export function createBrainRegionBlobGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(1, 64, 44);
  const positions = geometry.attributes.position;
  const direction = new Vector3();
  const contourLobes = [
    { angle: -2.72, strength: 0.28 },
    { angle: -1.64, strength: 0.35 },
    { angle: -0.31, strength: 0.23 },
    { angle: 0.88, strength: 0.32 },
    { angle: 2.06, strength: 0.27 },
    { angle: 2.91, strength: 0.2 },
  ].map(({ angle, strength }) => ({
    direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.06).normalize(),
    strength,
  }));

  for (let index = 0; index < positions.count; index += 1) {
    direction.fromBufferAttribute(positions, index).normalize();
    const { x, y, z } = direction;
    const outlineLobes = contourLobes.reduce((sum, lobe) => {
      const alignment = direction.dot(lobe.direction);
      return sum + lobe.strength * Math.exp((alignment - 1) * 10);
    }, 0);
    const frontAndBackRoundness = 0.12 * Math.pow(Math.abs(z), 3);
    const surfaceVariation = 0.045 * Math.sin(x * 4.8 + y * 2.7) * Math.cos(z * 4.1 - y * 1.9);
    const radius = 0.72 + outlineLobes + frontAndBackRoundness + surfaceVariation;
    positions.setXYZ(index, x * radius, y * radius, z * radius);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

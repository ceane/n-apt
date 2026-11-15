export type AnatomyPoint = readonly [number, number, number];

export type PickablePhysiologyArea = {
  name: string;
  position: AnatomyPoint;
};

/**
 * Picks a physiology area from a hit point in the model asset's source space.
 * The head has several close area centers, so use the visible face and ear
 * boundaries before falling back to nearest-center selection for the body.
 */
export function resolvePhysiologyAreaAtPoint<T extends PickablePhysiologyArea>(
  point: AnatomyPoint,
  areas: readonly T[],
): T | null {
  const [x, y, z] = point;
  const eyes = areas.find((area) => area.name === "Eyes");
  if (eyes) {
    const dx = x - eyes.position[0];
    const dy = y - eyes.position[1];
    const dz = z - eyes.position[2];
    if (Math.abs(dx) <= 0.055 && Math.abs(dy) <= 0.03 && Math.abs(dz) <= 0.055) return eyes;
  }

  const ear = areas.find((area) => area.name === `Ears (${x < 0 ? "Left" : "Right"})`);
  if (ear) {
    const dx = (x - ear.position[0]) / 0.035;
    const dy = (y - ear.position[1]) / 0.055;
    const dz = (z - ear.position[2]) / 0.095;
    if (dx * dx + dy * dy + dz * dz <= 1) return ear;
  }

  if (y >= 1.45 && y <= 1.78) {
    const side = x < 0 ? "Left" : "Right";
    const lateral = Math.abs(x);
    if (lateral >= 0.72) {
      const hand = areas.find((area) => area.name === `Hands (${side})`);
      if (hand) return hand;
    }
    if (lateral >= 0.18) {
      const arm = areas.find((area) => area.name === `Arms (${side})`);
      if (arm) return arm;
    }
  }

  const head = areas.find((area) => area.name === "Head");
  if (head) {
    const relativeX = x - head.position[0];
    const relativeY = y - head.position[1];
    const relativeZ = z - head.position[2];
    const faceLateral = Math.abs(relativeX);

    if (relativeZ > 0.025 && relativeY >= -0.2 && relativeY <= 0.08 && faceLateral <= 0.13) {
      const face = areas.find((area) => area.name === "Face");
      if (face) return face;
    }

  }

  let nearestArea: T | null = null;
  let nearestDistance = Infinity;
  for (const area of areas) {
    if (area.name.startsWith("Ears (")) continue;
    const dx = x - area.position[0];
    const dy = y - area.position[1];
    const dz = z - area.position[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestArea = area;
    }
  }
  return nearestArea;
}

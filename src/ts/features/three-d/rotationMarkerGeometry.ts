export function rotationMarkerOrbits(radius: number) {
  const centerSeparation = radius * 0.5;
  const openArc = Math.PI * 1.58;

  return [
    {
      radius,
      tubeRadius: radius * 0.15,
      offset: [-centerSeparation / 2, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      arc: openArc,
    },
    {
      radius,
      tubeRadius: radius * 0.15,
      offset: [centerSeparation / 2, 0, 0] as [number, number, number],
      rotation: [Math.PI / 2, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      arc: openArc,
    },
  ] as const;
}

export function rotationMarkerArrowHead(radius: number, angle: number) {
  const tangentX = -Math.sin(angle);
  const tangentY = Math.cos(angle);
  const height = radius * 0.48;

  return {
    position: [
      radius * Math.cos(angle) + tangentX * height / 2,
      radius * Math.sin(angle) + tangentY * height / 2,
      0,
    ] as [number, number, number],
    rotationZ: Math.atan2(tangentY, tangentX) - Math.PI / 2,
    radius: radius * 0.18,
    height,
  };
}

import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { CatmullRomCurve3, Group, Matrix3, Mesh, Object3D, Raycaster, SkinnedMesh, Vector3 } from "three";
import type { LowerLegMuscleSurface } from "@n-apt/three-d/lowerLegFootMusclePaths";

export type ModelOffset = [number, number, number];
export type MuscleSurface = LowerLegMuscleSurface | "anterolateral";

const surfaceAnchoredPathCache = new WeakMap<Object3D, Map<string, ModelOffset[][]>>();

// The reference GLTF is a fixed pose. Bake skinning once and index its triangles
// without modifying the rendered geometry, skeleton, or global Mesh prototype.
const projectionBodies = new WeakMap<Object3D, Group>();
export function prepareMuscleProjection(scene: Object3D): Group {
  const cached = projectionBodies.get(scene);
  if (cached) return cached;
  scene.updateWorldMatrix(true, true);
  const body = new Group();
  const point = new Vector3();
  (scene.getObjectByName("GhostBody") ?? scene).traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (object instanceof SkinnedMesh) object.skeleton.update();
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      object.getVertexPosition(i, point);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    geometry.morphAttributes = {};
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.boundsTree = new MeshBVH(geometry);
    const proxy = new Mesh(geometry, object.material);
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(object.matrixWorld);
    proxy.raycast = acceleratedRaycast;
    body.add(proxy);
  });
  body.updateMatrixWorld(true);
  projectionBodies.set(scene, body);
  return body;
}

export function sourceSurfaceDirection(point: Vector3, surface: MuscleSurface): Vector3 {
  const side = point.x < 0 ? -1 : 1;
  if (surface === "anterior" || surface === "dorsal") return new Vector3(0, 0, 1);
  if (surface === "posterior") return new Vector3(0, 0, -1);
  if (surface === "lateral") return new Vector3(side, 0, 0);
  if (surface === "medial") return new Vector3(-side, 0, 0);
  if (surface === "plantar") return new Vector3(0, -1, 0);
  return new Vector3(side * Math.max(Math.abs(point.x) - 0.08, 0.025), 0, point.z).normalize();
}

function projectSourcePathToBodySurface(
  scene: Object3D,
  sourcePoints: ModelOffset[],
  surface: MuscleSurface = "anterolateral",
  maxProjectionDistance = 0.16,
  surfaceLiftOverride?: number,
): ModelOffset[] {
  const bodySurface = prepareMuscleProjection(scene);
  const curve = new CatmullRomCurve3(sourcePoints.map((point) => new Vector3(...point)), false, "centripetal");
  const raycaster = new Raycaster();
  raycaster.near = 0;
  raycaster.far = 0.7;
  // Keep the ribbon centerline nearly flush with the mesh. The glow already
  // adds a small visible radius, so a larger lift looks detached at grazing angles.
  const surfaceLift = surfaceLiftOverride ?? (surface === "anterolateral" ? 0.0012 : 0.0035);
  const samples = Math.max(24, (sourcePoints.length - 1) * 6);

  const projectedPoints = Array.from({ length: samples + 1 }, (_, index): ModelOffset | null => {
    const sourcePoint = curve.getPoint(index / samples);
    const side = sourcePoint.x < 0 ? -1 : 1;
    const primaryDirection = sourceSurfaceDirection(sourcePoint, surface);

    const sourceWorld = scene.localToWorld(sourcePoint.clone());
    const lateral = new Vector3(side, 0, 0);
    // The fibular nerve uses a radial anterolateral ray. Muscle paths use the
    // anatomical surface they occupy so a tendon cannot snap to the opposite
    // side of the leg or foot.
    const directions = surface === "anterolateral"
      ? [
          primaryDirection,
          lateral,
          lateral.clone().add(new Vector3(0, 0, 0.65)).normalize(),
          lateral.clone().add(new Vector3(0, 0, -0.65)).normalize(),
          new Vector3(0, 0, 1),
          new Vector3(0, 0, -1),
        ]
      : [primaryDirection];

    for (const direction of directions) {
      const directionWorld = direction.clone().transformDirection(scene.matrixWorld);
      const rayOrigin = sourceWorld.clone().addScaledVector(directionWorld, 0.35);
      raycaster.set(rayOrigin, directionWorld.clone().negate());
      const hit = raycaster.intersectObject(bodySurface, true).find((candidate) => {
        const localHit = scene.worldToLocal(candidate.point.clone());
        return candidate.point.distanceTo(sourceWorld) <= maxProjectionDistance
          && Math.abs(localHit.y - sourcePoint.y) <= 0.025
          && localHit.x * side >= -0.005;
      });
      if (!hit) continue;

      const normalMatrix = new Matrix3().getNormalMatrix(hit.object.matrixWorld);
      const normal = hit.normal?.clone().applyMatrix3(normalMatrix)
        ?? hit.face?.normal.clone().applyMatrix3(normalMatrix)
        ?? directionWorld.clone().negate();
      const liftedHit = hit.point.clone().addScaledVector(normal.normalize(), surfaceLift);
      const localHit = scene.worldToLocal(liftedHit);
      return [localHit.x, localHit.y, localHit.z];
    }

    return null;
  });

  // Interpolate small gaps at mesh seams. Never fall back to the guessed point,
  // which can leave a visible strand floating outside the model.
  const firstHit = projectedPoints.findIndex((point) => point !== null);
  if (firstHit < 0) return [];
  for (let index = 0; index < firstHit; index += 1) projectedPoints[index] = projectedPoints[firstHit];
  let previousHit = firstHit;
  for (let index = firstHit + 1; index < projectedPoints.length; index += 1) {
    if (projectedPoints[index]) {
      const nextHit = index;
      const start = projectedPoints[previousHit]!;
      const end = projectedPoints[nextHit]!;
      for (let gap = previousHit + 1; gap < nextHit; gap += 1) {
        const t = (gap - previousHit) / (nextHit - previousHit);
        projectedPoints[gap] = [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
          start[2] + (end[2] - start[2]) * t,
        ];
      }
      previousHit = nextHit;
    }
  }
  for (let index = previousHit + 1; index < projectedPoints.length; index += 1) projectedPoints[index] = projectedPoints[previousHit];
  return projectedPoints.filter((point): point is ModelOffset => point !== null);
}

export function getSurfaceAnchoredPaths(
  scene: Object3D,
  name: string,
  sourcePaths: ModelOffset[][],
  surface: MuscleSurface = "anterolateral",
  maxProjectionDistance = 0.16,
  surfaceLiftOverride?: number,
): ModelOffset[][] {
  let sceneCache = surfaceAnchoredPathCache.get(scene);
  if (!sceneCache) {
    sceneCache = new Map();
    surfaceAnchoredPathCache.set(scene, sceneCache);
  }
  const cacheKey = `${name}:${surface}:${maxProjectionDistance}:${surfaceLiftOverride ?? "default"}`;
  const sourceFingerprint = sourcePaths
    .map((path) => path.map((point) => point.join(",")).join(";"))
    .join("|");
  const fingerprintedCacheKey = `${cacheKey}:${sourceFingerprint}`;
  const cachedPaths = sceneCache.get(fingerprintedCacheKey);
  if (cachedPaths) return cachedPaths;
  scene.updateWorldMatrix(true, true);
  const anchoredPaths = sourcePaths.map((path) => projectSourcePathToBodySurface(scene, path, surface, maxProjectionDistance, surfaceLiftOverride));
  sceneCache.set(fingerprintedCacheKey, anchoredPaths);
  return anchoredPaths;
}

export type SurfaceRibbonEdges = {
  left: ModelOffset[];
  right: ModelOffset[];
};

/** Projects both sides of a ribbon so its width follows curved body surfaces. */
export function getSurfaceAnchoredRibbonEdges(
  scene: Object3D,
  name: string,
  centerline: ModelOffset[],
  surface: MuscleSurface,
  halfWidth: number,
  surfaceLiftOverride?: number,
): SurfaceRibbonEdges | null {
  if (centerline.length < 2) return null;
  const curve = new CatmullRomCurve3(centerline.map((point) => new Vector3(...point)), false, "centripetal");
  const edgeControlCount = Math.min(9, Math.max(4, centerline.length));
  const leftControls: ModelOffset[] = [];
  const rightControls: ModelOffset[] = [];
  for (let index = 0; index < edgeControlCount; index += 1) {
    const t = index / (edgeControlCount - 1);
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const across = sourceSurfaceDirection(center, surface).cross(tangent);
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
    const taper = Math.max(0.06, Math.sin(Math.PI * t) ** 0.65);
    across.normalize().multiplyScalar(halfWidth * taper);
    const left = center.clone().add(across);
    const right = center.clone().sub(across);
    leftControls.push([left.x, left.y, left.z]);
    rightControls.push([right.x, right.y, right.z]);
  }
  const maxProjectionDistance = Math.max(halfWidth * 2.5, 0.035);
  const left = getSurfaceAnchoredPaths(scene, `${name}:left:${halfWidth}`, [leftControls], surface, maxProjectionDistance, surfaceLiftOverride)[0];
  const right = getSurfaceAnchoredPaths(scene, `${name}:right:${halfWidth}`, [rightControls], surface, maxProjectionDistance, surfaceLiftOverride)[0];
  if (left.length < 2 || right.length !== left.length) return null;
  return { left, right };
}

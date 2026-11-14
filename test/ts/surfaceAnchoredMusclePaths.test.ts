import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { getSurfaceAnchoredPaths } from '@n-apt/three-d/surfaceAnchoredMusclePaths';

describe('surface-anchored muscle paths', () => {
  test('projects a cheek path onto the body surface with a small lift', () => {
    const scene = new Group();
    const body = new Mesh(
      new PlaneGeometry(4, 4),
      new MeshBasicMaterial({ side: DoubleSide }),
    );
    body.name = 'GhostBody';
    scene.add(body);

    const sourcePaths: [number, number, number][][] = [[
      [0.05, 1.88, 0.08],
      [0.06, 1.865, 0.08],
      [0.07, 1.85, 0.08],
    ]];

    const [projectedPath] = getSurfaceAnchoredPaths(
      scene,
      'zygomaticus-major-test',
      sourcePaths,
      'anterolateral',
    );

    expect(projectedPath.length).toBeGreaterThan(sourcePaths[0].length);
    projectedPath.forEach(([, , z]) => expect(z).toBeCloseTo(0.0012, 4));
  });
});

test('projects new selections without repeatedly raycasting the original dense body', () => {
  const scene = new Group();
  const body = new Mesh(new PlaneGeometry(4, 4, 50, 50), new MeshBasicMaterial({ side: DoubleSide }));
  body.name = 'GhostBody';
  scene.add(body);
  const raycast = jest.spyOn(body, 'raycast');
  const result = getSurfaceAnchoredPaths(scene, 'accelerated', [[[.1, 1.8, .05], [.2, 1.7, .05]]], 'anterior');
  expect(result[0].length).toBeGreaterThan(2);
  expect(result[0][0][2]).toBeCloseTo(.0035, 4);
  expect(raycast).not.toHaveBeenCalled();
});

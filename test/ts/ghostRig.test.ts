import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { createGhostRig, animateGhostRig } from '../../src/app-legal/components/ghostRig';

function fixture() {
  const scene = new Group();
  const neck = new Bone(); neck.name = 'neck';
  const upper = new Bone(); upper.name = 'neck.02'; upper.position.y = 0.1;
  const head = new Bone(); head.name = 'head'; head.position.y = 0.1;
  scene.add(neck); neck.add(upper); upper.add(head);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, .4, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([2, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.morphTargetDictionary = { eyeBlinkLeft: 0, eyeBlinkRight: 1, eyeWideLeft: 2, jawOpen: 3 };
  mesh.morphTargetInfluences = [0, 0, 0, 0];
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([neck, upper, head]));
  return { scene, mesh, head };
}

test('ghost instances deform their own skeleton without moving the cached source or another ghost', () => {
  const source = fixture();
  const first = createGhostRig(source.scene);
  const second = createGhostRig(source.scene);
  expect(first.bones.map(({ bone }) => bone.name)).toEqual(['neck', 'neck.02', 'head']);
  animateGhostRig(first, 2, 'peeking');
  first.scene.updateMatrixWorld(true);
  const mesh = first.meshes[0] as SkinnedMesh;
  const vertex = mesh.applyBoneTransform(0, new Vector3(0, .4, 0));
  expect(Math.abs(vertex.z)).toBeGreaterThan(.01);
  expect(source.head.quaternion.w).toBe(1);
  expect(second.scene.getObjectByName('head')!.quaternion.w).toBe(1);
  expect(source.mesh.morphTargetInfluences).toEqual([0, 0, 0, 0]);
  expect(first.meshes[0].morphTargetInfluences![3]).toBeGreaterThan(0);
});

test('blinks close both eyes, suppress widening, and reopen without accumulating bone rotations', () => {
  const rig = createGhostRig(fixture().scene);
  animateGhostRig(rig, 3.14, 'peeking');
  const closed = rig.meshes[0].morphTargetInfluences!;
  expect(closed[0]).toBeGreaterThan(.9);
  expect(closed[1]).toBeGreaterThan(.9);
  expect(closed[2]).toBeLessThan(.05);
  animateGhostRig(rig, 2, 'peeking');
  const rotation = rig.scene.getObjectByName('head')!.quaternion.clone();
  animateGhostRig(rig, 2, 'peeking');
  expect(rig.scene.getObjectByName('head')!.quaternion.equals(rotation)).toBe(true);
  expect(rig.meshes[0].morphTargetInfluences![0]).toBe(0);
});

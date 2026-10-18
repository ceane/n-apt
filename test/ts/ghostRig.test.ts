import { Bone, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { createGhostRig, animateGhostRig, applyAPose, applyHeartClutchPose, createDeformationDepthPass, GHOST_DEPTH_FRAGMENT_SHADER } from '../../src/app-legal/components/ghostRig';

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

function swallowingFixture() {
  const source = fixture();
  const names = ['gulpMouthOpen', 'gulpThroatHigh', 'gulpThroatMid', 'gulpThroatLow'];
  names.forEach((name, i) => { source.mesh.morphTargetDictionary![name] = i + 4; source.mesh.morphTargetInfluences!.push(0); });
  const interior = source.mesh.clone();
  interior.name = 'gulpMouthInterior';
  source.scene.add(interior);
  const tongue = source.mesh.clone();
  tongue.name = 'gulpTongue';
  source.scene.add(tongue);
  return source;
}

test('swallow travels down neck morphs and clears without translating neck bones or scaling the tongue', () => {
  const rig = createGhostRig(swallowingFixture().scene);
  const tongue = rig.scene.getObjectByName('gulpTongue')!;
  const interior = rig.scene.getObjectByName('gulpMouthInterior')!;
  const initialInteriorMaterial = (interior as Mesh).material as MeshBasicMaterial;
  expect(interior.visible).toBe(false);
  expect(tongue.visible).toBe(false);
  expect(initialInteriorMaterial.opacity).toBe(0);
  const scale = tongue.scale.clone();
  const position = tongue.position.clone();
  for (const [time, index] of [[4.30, 5], [4.48, 6], [4.65, 7]]) {
    animateGhostRig(rig, time, 'twitching');
    const values = rig.meshes[0].morphTargetInfluences!;
    const opening = values[4];
    expect(opening).toBe(0);
    expect(interior.visible).toBe(false);
    expect(tongue.visible).toBe(false);
    for (const anatomy of [interior, tongue]) {
      const anatomyMesh = anatomy as SkinnedMesh;
      const material = Array.isArray(anatomyMesh.material) ? anatomyMesh.material[0] : anatomyMesh.material;
      expect(material.opacity).toBe(0);
      expect(anatomyMesh.morphTargetInfluences![4]).toBe(0);
    }
    expect(values[index]).toBeGreaterThan(.7);
    expect(values[index]).toBe(Math.max(...values.slice(5)));
    for (const { bone, restPosition } of rig.bones) expect(bone.position.equals(restPosition)).toBe(true);
    expect(tongue.scale.equals(scale)).toBe(true);
    expect(tongue.position.equals(position)).toBe(true);
  }
  animateGhostRig(rig, 3.56, 'twitching');
  const partialOpening = rig.meshes[0].morphTargetInfluences![4];
  expect(partialOpening).toBeGreaterThan(0.1);
  expect(partialOpening).toBeLessThan(0.9);
  expect(interior.visible).toBe(true);
  expect(((interior as Mesh).material as MeshBasicMaterial).opacity).toBeCloseTo(partialOpening);
  expect(rig.meshes[0].morphTargetInfluences!.slice(5)).toEqual([0, 0, 0]);
  animateGhostRig(rig, 4.85, 'twitching');
  expect(interior.visible).toBe(false);
  expect(tongue.visible).toBe(false);
  expect(rig.meshes[0].morphTargetInfluences!.slice(4)).toEqual([0, 0, 0, 0]);
  animateGhostRig(rig, 3.93, 'evil');
  expect(interior.visible).toBe(true);
  expect(tongue.visible).toBe(true);
  expect(rig.meshes[0].morphTargetInfluences!.slice(4)).toEqual([0, 0, 0, 0]);
  expect(rig.scene.getObjectByName('gulpThroatLump')).toBeUndefined();
});

test('swallow morphs do not change a second instance or cached source', () => {
  const source = swallowingFixture();
  const first = createGhostRig(source.scene);
  const second = createGhostRig(source.scene);
  animateGhostRig(first, 4.48, 'twitching');
  expect(first.meshes[0].morphTargetInfluences![6]).toBeGreaterThan(.7);
  expect(second.meshes[0].morphTargetInfluences!.slice(4)).toEqual([0, 0, 0, 0]);
  expect(source.mesh.morphTargetInfluences!.slice(4)).toEqual([0, 0, 0, 0]);
});

test('evil ghost shows the mouth interior in sync with its open jaw', () => {
  const rig = createGhostRig(swallowingFixture().scene);
  const body = rig.meshes[0];
  const interior = rig.scene.getObjectByName('gulpMouthInterior') as Mesh;
  const tongue = rig.scene.getObjectByName('gulpTongue') as Mesh;

  animateGhostRig(rig, 0, 'evil');

  expect(body.morphTargetInfluences![3]).toBeGreaterThan(0.1);
  expect(interior.visible).toBe(true);
  expect(tongue.visible).toBe(true);
  expect(interior.morphTargetInfluences![3]).toBe(body.morphTargetInfluences![3]);
  expect(tongue.morphTargetInfluences![3]).toBe(body.morphTargetInfluences![3]);
  expect((interior.material as MeshBasicMaterial).opacity).toBeGreaterThan(0.8);
});


test('depth pass follows the exact skin and morph state of its source', () => {
  const rig = createGhostRig(swallowingFixture().scene);
  const source = rig.meshes[0] as SkinnedMesh;
  const depth = createDeformationDepthPass(source, new MeshBasicMaterial()) as SkinnedMesh;
  expect(depth.skeleton).toBe(source.skeleton);
  animateGhostRig(rig, 4.48, 'twitching');
  expect(depth.morphTargetInfluences).toBe(source.morphTargetInfluences);
  expect(depth.morphTargetInfluences![6]).toBeGreaterThan(.7);
});

test('mouth depth follows the deformed lip geometry instead of a fixed aperture', () => {
  expect(GHOST_DEPTH_FRAGMENT_SHADER).not.toContain('mouthOpening');
  expect(GHOST_DEPTH_FRAGMENT_SHADER).not.toContain('1.843');
});

test('mouth opens and closes before the throat gulp travels downward', () => {
  const rig = createGhostRig(swallowingFixture().scene);
  const values = () => rig.meshes[0].morphTargetInfluences!;

  animateGhostRig(rig, 3.56, 'twitching');
  expect(values()[4]).toBeGreaterThan(0);
  expect(values()[4]).toBeLessThan(1);
  expect(values().slice(5)).toEqual([0, 0, 0]);

  animateGhostRig(rig, 3.7, 'twitching');
  expect(values()[4]).toBeCloseTo(1);
  expect(values().slice(5).every((value) => value < 0.1)).toBe(true);

  animateGhostRig(rig, 4.05, 'twitching');
  expect(values()[4]).toBe(0);
  expect(values().slice(5)).toEqual([0, 0, 0]);

  for (const [time, activeIndex] of [[4.30, 5], [4.48, 6], [4.65, 7]]) {
    animateGhostRig(rig, time, 'twitching');
    expect(values()[4]).toBe(0);
    expect(values()[activeIndex]).toBeGreaterThan(0.7);
    expect(values()[activeIndex]).toBe(Math.max(...values().slice(5)));
  }

  animateGhostRig(rig, 4.85, 'twitching');
  expect(values()[4]).toBe(0);
  expect(values().slice(5)).toEqual([0, 0, 0]);
});

test('head flick snaps away and recoils instead of turning smoothly', () => {
  const rig = createGhostRig(fixture().scene);
  const head = rig.scene.getObjectByName('head')!;
  animateGhostRig(rig, 2.5, 'twitching');
  const before = head.quaternion.clone();
  animateGhostRig(rig, 2.56, 'twitching');
  const snap = head.quaternion.clone();
  expect(before.angleTo(snap)).toBeGreaterThan(0.2);
  animateGhostRig(rig, 2.68, 'twitching');
  expect(snap.angleTo(head.quaternion)).toBeGreaterThan(0.08);
});


test('authored heart pose keeps twist and elbow correction independent and resets on deselection', () => {
  const source = fixture();
  const arm = new Bone(); arm.name = 'upper_arm.L';
  const forearm = new Bone(); forearm.name = 'forearm.L';
  const twist = new Bone(); twist.name = 'forearm_twist.02.L';
  const hand = new Bone(); hand.name = 'hand.L';
  source.scene.add(arm); arm.add(forearm); forearm.add(twist, hand);
  for (const [bone, angle] of [[arm, .6], [forearm, 1.3], [twist, .25], [hand, -.4]] as const) {
    bone.userData.heartClutchRotation = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  }
  source.mesh.morphTargetDictionary!.heartClutchElbows = 4;
  source.mesh.morphTargetInfluences!.push(0);
  const first = createGhostRig(source.scene);
  const second = createGhostRig(source.scene);
  applyHeartClutchPose(first.scene, source.scene);
  const firstHand = first.scene.getObjectByName('hand.L')!;
  const firstTwist = first.scene.getObjectByName('forearm_twist.02.L')!;
  expect(firstHand.quaternion.toArray()).toEqual(hand.userData.heartClutchRotation);
  expect(firstTwist.quaternion.toArray()).toEqual(twist.userData.heartClutchRotation);
  animateGhostRig(first, 2, 'evil');
  expect(first.meshes[0].morphTargetInfluences![4]).toBe(1);
  expect(second.meshes[0].morphTargetInfluences![4]).toBe(0);
  expect(source.mesh.morphTargetInfluences![4]).toBe(0);
  expect(second.scene.getObjectByName('hand.L')!.quaternion.w).toBe(1);
  expect(hand.quaternion.w).toBe(1);
  applyAPose(first.scene, source.scene);
  expect(firstHand.quaternion.w).toBe(1);
  expect(firstTwist.quaternion.w).toBe(1);
  expect(first.meshes[0].morphTargetInfluences![4]).toBe(0);
});

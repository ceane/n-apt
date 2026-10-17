/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('shared neutral export retains the neck skin and independently addressable facial shapes', () => {
  const path = resolve('public/glb_models/human_model_neutral.glb');
  expect(existsSync(path)).toBe(true);
  const data = readFileSync(path);
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  const joints = gltf.skins.flatMap((skin: { joints: number[] }) => skin.joints.map((i) => gltf.nodes[i].name));
  expect(joints).toEqual(expect.arrayContaining(['neck', 'neck.02', 'head']));
  const body = gltf.meshes[gltf.nodes.find((node: { name: string }) => node.name === 'human_model_neutral').mesh];
  expect(body.extras.targetNames).toEqual(expect.arrayContaining([
    'eyeBlinkLeft', 'eyeBlinkRight', 'eyeWideLeft', 'eyeWideRight',
    'eyeSquintLeft', 'eyeSquintRight', 'browDownLeft', 'browDownRight',
    'mouthSmileLeft', 'mouthSmileRight', 'mouthSneerLeft', 'mouthSneerRight', 'jawOpen',
  ]));
  expect(body.primitives[0].attributes.JOINTS_0).toBeDefined();
  for (const target of body.primitives[0].targets) {
    const accessor = gltf.accessors[target.POSITION];
    expect(accessor.max.some((n: number, i: number) => n !== accessor.min[i])).toBe(true);
  }
});

test('mouth anatomy is skinned and throat motion is exported as surface morphs', () => {
  const data = readFileSync(resolve('public/glb_models/human_model_neutral.glb'));
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  const body = gltf.meshes[gltf.nodes.find((node: { name: string }) => node.name === 'human_model_neutral').mesh];
  expect(body.extras.targetNames).toEqual(expect.arrayContaining(['gulpMouthOpen', 'gulpThroatHigh', 'gulpThroatMid', 'gulpThroatLow']));
  for (const name of ['gulpMouthInterior', 'gulpTongue']) {
    const node = gltf.nodes.find((n: { name: string }) => n.name === name);
    expect(node.skin).toBeDefined();
    const mesh = gltf.meshes[node.mesh];
    expect(mesh.extras.targetNames).toContain('gulpMouthOpen');
    for (const primitive of mesh.primitives) {
      expect(primitive.attributes.JOINTS_0).toBeDefined();
      expect(primitive.attributes.WEIGHTS_0).toBeDefined();
      expect(primitive.material).toBeDefined();
      const color = gltf.materials[primitive.material].pbrMetallicRoughness.baseColorFactor;
      expect(color[0]).toBeCloseTo(color[1]);
      expect(color[1]).toBeCloseTo(color[2]);
      expect(color[0]).toBeLessThan(.25);
    }
  }
  expect(gltf.nodes.some((n: { name: string }) => n.name === 'gulpThroatLump')).toBe(false);
});

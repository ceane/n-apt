/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('ghost export retains the neck skin and independently addressable facial shapes', () => {
  const path = resolve('public/glb_models/human_ghost_expressive.glb');
  expect(existsSync(path)).toBe(true);
  const data = readFileSync(path);
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  const joints = gltf.skins.flatMap((skin: { joints: number[] }) => skin.joints.map((i) => gltf.nodes[i].name));
  expect(joints).toEqual(expect.arrayContaining(['neck', 'neck.02', 'head']));
  const body = gltf.meshes.find((mesh: { extras?: { targetNames?: string[] } }) => mesh.extras?.targetNames?.includes('jawOpen'));
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

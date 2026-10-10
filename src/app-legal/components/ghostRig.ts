import { Bone, Euler, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type GhostVariant = 'evil' | 'peeking';

const armAxis = new Vector3(1, 0, 0);
const aPoseJoints = [
  { name: 'clavicleL', rotation: new Quaternion().setFromAxisAngle(armAxis, -0.42) },
  { name: 'clavicleR', rotation: new Quaternion().setFromAxisAngle(armAxis, -0.42) },
  { name: 'upper_armL', rotation: new Quaternion().setFromAxisAngle(armAxis, -0.36) },
  { name: 'upper_armR', rotation: new Quaternion().setFromAxisAngle(armAxis, -0.36) },
];

export function applyAPose(target: Object3D, source: Object3D) {
  for (const { name, rotation } of aPoseJoints) {
    const posedBone = target.getObjectByName(name);
    const restBone = source.getObjectByName(name);
    if (posedBone instanceof Bone && restBone instanceof Bone) {
      posedBone.quaternion.copy(restBone.quaternion).multiply(rotation);
    }
  }
}

export function createGhostRig(source: Object3D) {
  const scene = clone(source);
  applyAPose(scene, source);
  const meshes: Mesh[] = [];
  const bones: { bone: Bone; rest: Quaternion; restPosition: Bone['position']; weight: number }[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object);
      // Animated head bounds can extend beyond the GLB's rest-pose sphere.
      object.frustumCulled = false;
    }
    if (object instanceof Bone && ['neck', 'neck.02', 'head'].includes(object.name)) {
      bones.push({ bone: object, rest: object.quaternion.clone(), restPosition: object.position.clone(), weight: object.name === 'head' ? .3 : .35 });
    }
  });
  return { scene, meshes, bones, offset: new Quaternion(), euler: new Euler() };
}

export function animateGhostRig(rig: ReturnType<typeof createGhostRig>, time: number, variant: GhostVariant) {
  const peeking = variant === 'peeking';
  const cycle = (time % 5.2) / 5.2;
  const progress = cycle < .38 ? cycle / .38 : cycle < .62 ? 1 : (1 - cycle) / .38;
  const approach = progress * progress * (3 - 2 * progress);
  const pitch = .10 + Math.sin(time * .9) * .07;
  const yaw = peeking ? Math.sin(time * 1.2) * .18 * approach : .12 + Math.sin(time * .8) * .2;
  const tilt = peeking ? (.2 + Math.sin(time * 1.2) * .045) * approach : Math.sin(time * 1.2) * .08;
  for (const { bone, rest, restPosition, weight } of rig.bones) {
    const nodPhaseLag = bone.name === 'neck' ? 0 : bone.name === 'neck.02' ? .32 : .68;
    const peekingPitch = (.12 + .78 * Math.sin(time * 1.15 - nodPhaseLag)) * approach;
    const bonePitch = peeking ? peekingPitch : pitch;
    rig.offset.setFromEuler(rig.euler.set(bonePitch * weight, yaw * weight, tilt * weight));
    bone.quaternion.copy(rest).multiply(rig.offset);
    bone.position.copy(restPosition);
    if (peeking) {
      const forwardReach = bone.name === 'neck' ? .035 : bone.name === 'neck.02' ? .045 : .045;
      bone.position.z += forwardReach * approach;
    }
  }
  // A brief, smooth blink; eye shape controls yield to complete eyelid closure.
  const blinkPhase = (time % 4.7) - 3;
  const blink = blinkPhase >= 0 && blinkPhase <= .28 ? Math.sin(blinkPhase / .28 * Math.PI) ** 2 : 0;
  for (const mesh of rig.meshes) {
    const dictionary = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) continue;
    for (const [name, index] of Object.entries(dictionary)) {
      let value = 0;
      if (name.startsWith('eyeBlink')) value = blink;
      else if (name.startsWith('eyeWide')) value = peeking ? .65 * approach * (1 - blink) : 0;
      else if (name.startsWith('eyeSquint')) value = peeking ? 0 : .3 * (1 - blink);
      else if (name.startsWith('eyeAnger')) value = peeking ? 0 : 1 * (1 - blink);
      else if (name.startsWith('browDown')) value = peeking ? 0 : .8;
      else if (name.startsWith('mouthSmile')) value = peeking ? .12 : .85 + Math.sin(time * .7) * .08;
      else if (name.startsWith('mouthSneer')) value = peeking ? 0 : .35;
      else if (name === 'jawOpen') value = peeking ? .5 * approach : .2 + Math.sin(time) * .04;
      influences[index] = value;
    }
  }
  return approach;
}

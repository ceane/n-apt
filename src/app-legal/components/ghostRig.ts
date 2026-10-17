import { Bone, Euler, Matrix4, Material, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type GhostVariant = 'evil' | 'peeking' | 'twitching';

export const GHOST_DEPTH_FRAGMENT_SHADER = `
  varying float vLocalHeight;
  void main() {
    // Let the body's shaped lip boundary define the aperture. A fixed oval
    // here stays behind while the mouth morph moves the lips toward it.
    if (vLocalHeight < 1.78) discard;
    gl_FragColor = vec4(0.0);
  }
`;

const aPoseJoints = [
  { name: 'clavicle.L', rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.06) },
  { name: 'clavicle.R', rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.06) },
  { name: 'upper_arm.L', rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.52) },
  { name: 'upper_arm.R', rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.52) },
];
const heartClutchHandTargets = {
  // Place the palms in front of the heart so the hands read as covering it
  // instead of disappearing behind the heart marker.
  // The L hand rests against the chest; the R hand overlaps it from the front.
  L: new Vector3(0.075, 1.49, 0.14),
  R: new Vector3(0.115, 1.50, 0.18),
};

function getRigBone(root: Object3D, name: string) {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));
}

function aimBoneAt(bone: Bone, nextBone: Bone, end: Vector3, root: Object3D) {
  root.updateMatrixWorld(true);
  const start = bone.getWorldPosition(new Vector3());
  const currentEnd = nextBone.getWorldPosition(new Vector3());
  const currentDirection = currentEnd.sub(start).normalize();
  const desiredDirection = end.clone().sub(start).normalize();
  if (currentDirection.lengthSq() === 0 || desiredDirection.lengthSq() === 0) return;

  const worldRotation = bone.getWorldQuaternion(new Quaternion());
  worldRotation.premultiply(new Quaternion().setFromUnitVectors(currentDirection, desiredDirection));
  const parentRotation = bone.parent?.getWorldQuaternion(new Quaternion()).invert() ?? new Quaternion();
  bone.quaternion.copy(parentRotation.multiply(worldRotation));
  root.updateMatrixWorld(true);
}

export function applyAPose(target: Object3D, source: Object3D) {
  for (const side of ['L', 'R'] as const) {
    for (const segment of ['upper_arm', 'forearm', 'hand']) {
      const name = `${segment}.${side}`;
      const posedBone = getRigBone(target, name);
      const restBone = getRigBone(source, name);
      if (posedBone instanceof Bone && restBone instanceof Bone) posedBone.quaternion.copy(restBone.quaternion);
    }
  }
  for (const { name, rotation } of aPoseJoints) {
    const posedBone = getRigBone(target, name);
    const restBone = getRigBone(source, name);
    if (posedBone instanceof Bone && restBone instanceof Bone) {
      posedBone.quaternion.copy(restBone.quaternion).multiply(rotation);
    }
  }
}

export function applyHeartClutchPose(
  target: Object3D,
  source: Object3D,
  handTargets = heartClutchHandTargets,
) {
  source.updateMatrixWorld(true);
  applyAPose(target, source);
  target.updateMatrixWorld(true);

  for (const side of ['L', 'R'] as const) {
    const upperArm = getRigBone(target, `upper_arm.${side}`);
    const forearm = getRigBone(target, `forearm.${side}`);
    const hand = getRigBone(target, `hand.${side}`);
    const middleFinger = getRigBone(target, `middle.01.${side}`);
    const restUpperArm = getRigBone(source, `upper_arm.${side}`);
    const restForearm = getRigBone(source, `forearm.${side}`);
    const restHand = getRigBone(source, `hand.${side}`);
    if (!(upperArm instanceof Bone) || !(forearm instanceof Bone) || !(hand instanceof Bone) || !(middleFinger instanceof Bone)
      || !(restUpperArm instanceof Bone) || !(restForearm instanceof Bone) || !(restHand instanceof Bone)) continue;

    const aPoseRotation = aPoseJoints.find(({ name }) => name === `upper_arm.${side}`)?.rotation;
    upperArm.quaternion.copy(restUpperArm.quaternion);
    if (aPoseRotation) upperArm.quaternion.multiply(aPoseRotation);
    forearm.quaternion.copy(restForearm.quaternion);
    hand.quaternion.copy(restHand.quaternion);
    target.updateMatrixWorld(true);

    const shoulder = upperArm.getWorldPosition(new Vector3());
    const elbowRest = restForearm.getWorldPosition(new Vector3());
    const wristRest = restHand.getWorldPosition(new Vector3());
    const upperLength = shoulder.distanceTo(elbowRest);
    const forearmLength = elbowRest.distanceTo(wristRest);
    const wristTarget = handTargets[side].clone();
    const reach = wristTarget.clone().sub(shoulder);
    const distance = Math.min(reach.length(), upperLength + forearmLength - 0.001);
    if (distance < 0.001 || upperLength < 0.001 || forearmLength < 0.001) continue;

    const direction = reach.normalize();
    const along = (upperLength ** 2 - forearmLength ** 2 + distance ** 2) / (2 * distance);
    const bendHeight = Math.sqrt(Math.max(upperLength ** 2 - along ** 2, 0));
    // Keep elbows low and outside the chest; only the forearms cross over the heart.
    // In this GLB, the L arm is on +X and the R arm is on -X.
    const outward = new Vector3(side === 'L' ? 1 : -1, -0.65, 0.15);
    outward.addScaledVector(direction, -outward.dot(direction)).normalize();
    const elbowTarget = shoulder.clone().addScaledVector(direction, along).addScaledVector(outward, bendHeight);

    aimBoneAt(upperArm, forearm, elbowTarget, target);
    aimBoneAt(forearm, hand, wristTarget, target);
    // Local +Y follows the fingers. Set the complete hand frame so the
    // palms lie against the chest rather than retaining the arm's twist.
    const fingerDirection = new Vector3(side === 'L' ? 0.3 : -0.3, 0.74, -0.6).normalize();
    // Face the palms into the chest; the backs of the hands face outward.
    const handNormal = new Vector3(0, 0, 1);
    const acrossPalm = fingerDirection.clone().cross(handNormal).normalize();
    const worldHandRotation = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(acrossPalm, fingerDirection, handNormal),
    );
    const parentRotation = hand.parent!.getWorldQuaternion(new Quaternion()).invert();
    hand.quaternion.copy(parentRotation.multiply(worldHandRotation));
    target.updateMatrixWorld(true);
  }
}

/** A sibling draw of the same deformation, including live morph weights. */
export function createDeformationDepthPass(mesh: Mesh, material: Material) {
  const depth = mesh.clone(false);
  depth.material = material;
  depth.morphTargetInfluences = mesh.morphTargetInfluences;
  depth.frustumCulled = false;
  return depth;
}

export function createGhostRig(source: Object3D) {
  const scene = clone(source);
  applyAPose(scene, source);
  const meshes: Mesh[] = [];
  const gulpAnatomy: { mesh: Mesh; baseOpacity: number }[] = [];
  const bones: { bone: Bone; rest: Quaternion; restPosition: Bone['position']; weight: number }[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object);
      if (object.name === 'gulpMouthInterior' || object.name === 'gulpTongue') {
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const baseOpacity = sourceMaterials[0]?.opacity ?? 1;
        const makeGulpMaterial = (source: Material) => {
          const material = source.clone();
          material.transparent = true;
          material.opacity = 0;
          material.depthWrite = false;
          return material;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(makeGulpMaterial)
          : makeGulpMaterial(object.material);
        gulpAnatomy.push({ mesh: object, baseOpacity });
        object.visible = false;
      }
      // Animated head bounds can extend beyond the GLB's rest-pose sphere.
      object.frustumCulled = false;
    }
    if (object instanceof Bone && ['neck', 'neck.02', 'head'].includes(object.name)) {
      bones.push({ bone: object, rest: object.quaternion.clone(), restPosition: object.position.clone(), weight: object.name === 'head' ? .3 : .35 });
    }
  });
  return { scene, meshes, bones, gulpAnatomy, offset: new Quaternion(), euler: new Euler() };
}

function smoothStep(start: number, end: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function gaussianPulse(time: number, center: number, width: number) {
  const distance = (time - center) / width;
  return Math.exp(-0.5 * distance * distance);
}

function pulseWindow(time: number, start: number, end: number, fade: number) {
  return smoothStep(start, start + fade, time) * (1 - smoothStep(end - fade, end, time));
}

export function animateGhostRig(rig: ReturnType<typeof createGhostRig>, time: number, variant: GhostVariant) {
  const peeking = variant === 'peeking';
  const twitching = variant === 'twitching';
  const cycle = (time % 5.2) / 5.2;
  const phase = time % 5.2;
  const progress = cycle < .38 ? cycle / .38 : cycle < .62 ? 1 : (1 - cycle) / .38;
  const approach = progress * progress * (3 - 2 * progress);
  const twitchLeft = Math.max(gaussianPulse(phase, .42, .045), gaussianPulse(phase, .67, .05), gaussianPulse(phase, .96, .055));
  const twitchRight = Math.max(gaussianPulse(phase, .53, .05), gaussianPulse(phase, .79, .05), gaussianPulse(phase, 1.08, .055));
  const eyeWiden = pulseWindow(phase, 1.3, 2.05, .16);
  const headSnap = smoothStep(2.5, 2.53, phase) * (1 - smoothStep(2.6, 2.66, phase));
  const headRecoil = smoothStep(2.6, 2.62, phase) * (1 - smoothStep(2.71, 2.78, phase));
  const headFlick = headSnap - headRecoil * .35;
  const mouthOpen = pulseWindow(phase, 3.48, 4.05, .12);
  const throatSwallow = pulseWindow(phase, 4.15, 4.8, .1);
  const jawOpening = peeking ? .5 * approach : twitching ? 0 : .2 + Math.sin(time) * .04;
  const anatomyOpening = twitching ? mouthOpen : smoothStep(.04, .18, jawOpening);
  for (const { mesh, baseOpacity } of rig.gulpAnatomy) {
    mesh.visible = anatomyOpening > .001;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.opacity = baseOpacity * anatomyOpening;
  }
  const pitch = twitching ? .035 + throatSwallow * .09 + headFlick * .12 : .10 + Math.sin(time * .9) * .07;
  const yaw = twitching
    ? .06 + headFlick * 1.35
    : peeking ? Math.sin(time * 1.2) * .18 * approach : .12 + Math.sin(time * .8) * .2;
  const tilt = twitching
    ? Math.sin(time * 1.5) * .025 + headFlick * -.3
    : peeking ? (.2 + Math.sin(time * 1.2) * .045) * approach : Math.sin(time * 1.2) * .08;
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
      else if (name.startsWith('eyeWide')) value = peeking ? .65 * approach * (1 - blink) : twitching ? .82 * eyeWiden * (1 - blink) : 0;
      else if (name.startsWith('eyeSquint')) value = peeking ? 0 : twitching ? .46 * (name.endsWith('Left') ? twitchLeft : twitchRight) * (1 - blink) : .3 * (1 - blink);
      else if (name.startsWith('eyeAnger')) value = peeking || twitching ? 0 : 1 * (1 - blink);
      else if (name.startsWith('browDown')) value = peeking || twitching ? 0 : .8;
      else if (name.startsWith('mouthSmile')) value = peeking ? .12 : twitching ? 0 : .85 + Math.sin(time * .7) * .08;
      else if (name.startsWith('mouthSneer')) value = peeking || twitching ? 0 : .35;
      else if (name === 'jawOpen') value = jawOpening;
      else if (name === 'gulpMouthOpen') value = twitching ? mouthOpen : 0;
      else if (name === 'gulpThroatHigh') value = twitching ? throatSwallow * gaussianPulse(phase, 4.3, .095) : 0;
      else if (name === 'gulpThroatMid') value = twitching ? throatSwallow * gaussianPulse(phase, 4.48, .095) : 0;
      else if (name === 'gulpThroatLow') value = twitching ? throatSwallow * gaussianPulse(phase, 4.65, .095) : 0;
      influences[index] = value;
    }
  }
  return approach;
}

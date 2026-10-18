import { Bone, Euler, Material, Mesh, Object3D, Quaternion, Vector3 } from 'three';
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
// Authored in the canonical Blender model: the left palm rests on the chest
// over the heart; the right palm rests on the back of that hand. Both palms
// face inward. Keep the elbow corrective and these bone poses together when
// editing the asset, including the forearm twist bones and chest clearance.
type ArmPose = {
  joints: { bone: Bone; rest: Quaternion; heart: Quaternion }[];
  corrections: { mesh: Mesh; index: number }[];
};
const armPoses = new WeakMap<Object3D, ArmPose>();

function getRigBone(root: Object3D, name: string) {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));
}

function getArmPose(target: Object3D, source: Object3D): ArmPose {
  const cached = armPoses.get(target);
  if (cached) return cached;
  const pose: ArmPose = { joints: [], corrections: [] };
  target.traverse((object) => {
    if (object instanceof Bone) {
      const restBone = source.getObjectByName(object.name);
      const rotation: unknown = restBone?.userData.heartClutchRotation;
      if (restBone instanceof Bone && Array.isArray(rotation) && rotation.length === 4
        && rotation.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        const rest = restBone.quaternion.clone();
        pose.joints.push({ bone: object, rest, heart: rest.clone().multiply(new Quaternion().fromArray(rotation)) });
      }
    } else if (object instanceof Mesh) {
      const index = object.morphTargetDictionary?.heartClutchElbows;
      if (index !== undefined && object.morphTargetInfluences) pose.corrections.push({ mesh: object, index });
    }
  });
  armPoses.set(target, pose);
  return pose;
}

export function applyAPose(target: Object3D, source: Object3D) {
  const pose = getArmPose(target, source);
  for (const { bone, rest } of pose.joints) bone.quaternion.copy(rest);
  for (const { mesh, index } of pose.corrections) mesh.morphTargetInfluences![index] = 0;
  for (const { name, rotation } of aPoseJoints) {
    const posedBone = getRigBone(target, name);
    const restBone = getRigBone(source, name);
    if (posedBone instanceof Bone && restBone instanceof Bone) {
      posedBone.quaternion.copy(restBone.quaternion).multiply(rotation);
    }
  }
}

export function applyHeartClutchPose(target: Object3D, source: Object3D) {
  const pose = getArmPose(target, source);
  for (const { bone, heart } of pose.joints) bone.quaternion.copy(heart);
  for (const { mesh, index } of pose.corrections) mesh.morphTargetInfluences![index] = 1;
  target.updateMatrixWorld(true);
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
    const peekingPitch = (.08 + .42 * Math.sin(time * 1.15 - nodPhaseLag * .35)) * approach;
    const bonePitch = peeking ? peekingPitch : pitch;
    rig.offset.setFromEuler(rig.euler.set(bonePitch * weight, yaw * weight, tilt * weight));
    bone.quaternion.copy(rest).multiply(rig.offset);
    bone.position.copy(restPosition);
    if (peeking) {
      // Treat forward movement as one small reach shared by the whole neck
      // chain. Giving every joint the full reach accumulates translation and
      // pulls the neck skin apart at the joint-weight boundaries.
      const forwardReach = .045 * weight;
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
      // The arm pose owns this corrective; facial animation must not reset it.
      if (name === 'heartClutchElbows') continue;
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

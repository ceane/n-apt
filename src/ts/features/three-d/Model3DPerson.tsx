import React, { Suspense, useRef, useCallback, useEffect, useMemo } from "react";
import styled from "styled-components";
import { Canvas, useThree } from "@react-three/fiber";
import { Clone, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Box3, BufferGeometry, CatmullRomCurve3, DoubleSide, Float32BufferAttribute, Matrix3, Mesh, Object3D, PerspectiveCamera, Quaternion, Raycaster, ShapeUtils, TubeGeometry, Vector2, Vector3 } from "three";
import { gsap } from "gsap";
import { HorizonFocusGlobe } from "@n-apt/three-d/HorizonFocusGlobe";
import Brain from "@n-apt/three-d/Brain";
import { FACIAL_MUSCLE_SHAPES } from "@n-apt/three-d/facialMusclePaths";
import { LOWER_FACIAL_MUSCLE_PATHS } from "@n-apt/three-d/lowerFacialMusclePaths";
import { CRANIAL_NERVE_PATHS } from "@n-apt/three-d/cranialNervePaths";
import { COMMON_FIBULAR_NERVE_PATHS } from "@n-apt/three-d/commonFibularNervePaths";
import { HIP_THIGH_MUSCLE_PATHS } from "@n-apt/three-d/hipThighMusclePaths";
import { LOWER_LEG_FOOT_MUSCLE_PATHS } from "@n-apt/three-d/lowerLegFootMusclePaths";
import { LARYNGEAL_MUSCLE_PATHS } from "@n-apt/three-d/laryngealMusclePaths";
import { THROAT_SWALLOWING_MUSCLE_PATHS } from "@n-apt/three-d/throatSwallowingMusclePaths";
import { TONGUE_MUSCLE_PATHS } from "@n-apt/three-d/tongueMusclePaths";
import { SKIN_SENSATION_PATHS } from "@n-apt/three-d/skinSensationPaths";
import { UPPER_LIMB_MUSCLE_PATHS, getUpperLimbMuscleCameraFocus } from "@n-apt/three-d/upperLimbMusclePaths";
import { createBrainRegionBlobGeometry } from "@n-apt/three-d/brainRegionBlob";
import { NEUROMUSCULAR_JUNCTION_PATHS } from "@n-apt/three-d/neuromuscularJunctionPaths";
import { insetNervePathPoint } from "@n-apt/three-d/nervePathDepth";
import { SENSORY_PATHWAY_VIEWS, SPINAL_CORD_PATHS } from "@n-apt/three-d/spinalCordPaths";
import { AUTONOMIC_PATHWAYS, AUTONOMIC_PATHWAY_VIEWS } from "@n-apt/three-d/autonomicPathways";
import { getUpperLimbNerveCameraFocus } from "@n-apt/three-d/upperLimbNerveCameraFocus";
import { getSurfaceAnchoredPaths, getSurfaceAnchoredRibbonEdges, prepareMuscleProjection, sourceSurfaceDirection, type ModelOffset, type MuscleSurface } from "@n-apt/three-d/surfaceAnchoredMusclePaths";
import { resolvePhysiologyAreaAtPoint } from "@n-apt/three-d/physiologyAreaPicking";
import { createSurfaceEllipseContour } from "@n-apt/three-d/surfaceRegionContours";
import { resolveModelAnchor, type ModelAnchorName } from "@n-apt/three-d/modelAnchors";
import {
  createAnatomyFigureScene,
  disposeAnatomyFigureScene,
} from "@n-apt/three-d/anatomyScene";
import { HUMAN_MODEL_AFRO_MALE_GLB_URL } from "@n-apt/three-d";
import { useHotspotEditor } from "@n-apt/three-d/hooks/useHotspotEditor";
import { useModel3D, type Area } from "@n-apt/three-d/hooks/useModel3D";
import { attachModelWheelRotation } from "@n-apt/three-d/modelWheelRotation";
import {
  MODEL_AMBIENT_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_POSITION,
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
  MODEL_FILL_LIGHT_INTENSITY,
  MODEL_FILL_LIGHT_POSITION,
  MODEL_FOV,
  MODEL_KEY_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_POSITION,
  MODEL_ROOT_POSITION,
} from "@n-apt/consts";
import { useTheme } from "styled-components";

function worldToModelLocal(
  position: [number, number, number],
): [number, number, number] {
  return [
    position[0] - MODEL_ROOT_POSITION[0],
    position[1] - MODEL_ROOT_POSITION[1],
    position[2] - MODEL_ROOT_POSITION[2],
  ];
}

function findFigureSurfaceAnchor(
  scene: Object3D,
  areaName: string,
  target: [number, number, number],
  figurePosition: [number, number, number],
  figureScale: number,
  modelOffset: [number, number, number],
): { position: [number, number, number]; normal: [number, number, number] } | null {
  scene.updateWorldMatrix(true, true);
  const targetInRoot = new Vector3(...worldToModelLocal(target));
  const originLocal = new Vector3(
    (targetInRoot.x - figurePosition[0]) / figureScale - modelOffset[0],
    (targetInRoot.y - figurePosition[1]) / figureScale - modelOffset[1],
    (targetInRoot.z - figurePosition[2]) / figureScale - modelOffset[2],
  );
  const bodySurface = scene.getObjectByName("GhostBody") ?? scene;
  const surfaceDirection = regionSurfaceDirection(areaName, [originLocal.x, originLocal.y, originLocal.z]);
  const originWorld = scene.localToWorld(originLocal.clone());
  const directionWorld = surfaceDirection.clone().transformDirection(scene.matrixWorld);
  const raycaster = new Raycaster();
  const castDistance = 1;
  raycaster.far = castDistance * 2;
  const rayOrigin = originWorld.clone().addScaledVector(directionWorld, castDistance);
  raycaster.set(rayOrigin, directionWorld.clone().negate());
  const intersection = raycaster.intersectObject(bodySurface, true)[0];
  if (!intersection) return null;
  const point = scene.worldToLocal(intersection.point.clone());
  const normal = intersection.normal?.clone()
    ?? intersection.face?.normal?.clone().applyMatrix3(new Matrix3().getNormalMatrix(intersection.object.matrixWorld))
    ?? directionWorld.clone().negate();
  normal.normalize();
  const rootPosition = new Vector3(
    figurePosition[0] + (point.x + modelOffset[0]) * figureScale,
    figurePosition[1] + (point.y + modelOffset[1]) * figureScale,
    figurePosition[2] + (point.z + modelOffset[2]) * figureScale,
  ).addScaledVector(normal, 0.004);
  return {
    position: [rootPosition.x + MODEL_ROOT_POSITION[0], rootPosition.y + MODEL_ROOT_POSITION[1], rootPosition.z + MODEL_ROOT_POSITION[2]],
    normal: [normal.x, normal.y, normal.z],
  };
}

function regionSurfaceDirection(name: string, point: [number, number, number]): Vector3 {
  const lower = name.toLowerCase();
  if (/ear/.test(lower)) return new Vector3(0, 0, 1);
  if (/buttock/.test(lower)) return new Vector3(0, 0, -1);
  return new Vector3(0, 0, 1);
}

function sourcePointFromWorld(
  point: [number, number, number],
  figurePosition: [number, number, number],
  figureScale: number,
  modelOffset: [number, number, number],
): [number, number, number] {
  const local = worldToModelLocal(point);
  return [
    (local[0] - figurePosition[0]) / figureScale - modelOffset[0],
    (local[1] - figurePosition[1]) / figureScale - modelOffset[1],
    (local[2] - figurePosition[2]) / figureScale - modelOffset[2],
  ];
}

function physiologySourceCenter(name: string, scene: Object3D): [number, number, number] | null {
  if (name === "Face") return [0, 1.88, 0.1];
  if (name === "Eyes") return [0, 1.92, 0.105];
  if (/^Hands \((Left|Right)\)$/.test(name)) {
    return resolveModelAnchor(scene, name.includes("Left") ? "leftHand" : "rightHand");
  }
  if (/^Arms \((Left|Right)\)$/.test(name)) {
    const side = name.includes("Left") ? "Left" : "Right";
    const shoulder = resolveModelAnchor(scene, side === "Left" ? "leftShoulder" : "rightShoulder");
    const hand = resolveModelAnchor(scene, side === "Left" ? "leftHand" : "rightHand");
    if (!shoulder || !hand) return shoulder ?? hand;
    return [
      (shoulder[0] + hand[0]) / 2,
      (shoulder[1] + hand[1]) / 2,
      (shoulder[2] + hand[2]) / 2,
    ];
  }
  const head = resolveModelAnchor(scene, "head");
  if (!head) return null;
  if (name === "Head") return head;
  // Facial muscle source paths and model facial features use this same source
  // frame; the head bone sits too low to center a face patch reliably.
  if (name === "Ears (Left)") return [head[0] - 0.095, head[1] + 0.12, head[2] + 0.005];
  if (name === "Ears (Right)") return [head[0] + 0.095, head[1] + 0.12, head[2] + 0.005];
  return null;
}

function regionContour(name: string, halfWidth: number, halfHeight: number): [number, number][] {
  const lower = name.toLowerCase();
  if (/^face$/.test(lower)) {
    return [
      [0, 0.9], [0.42, 0.96], [0.76, 0.74], [0.94, 0.35],
      [0.98, -0.04], [0.82, -0.45], [0.55, -0.78], [0.2, -0.97],
      [0, -1], [-0.2, -0.97], [-0.55, -0.78], [-0.82, -0.45],
      [-0.98, -0.04], [-0.94, 0.35], [-0.76, 0.74], [-0.42, 0.96],
    ].map(([x, y]) => [x * halfWidth, y * halfHeight]);
  }
  if (/ear/.test(lower)) {
    return [
      [0.15, 1], [0.62, 0.86], [0.92, 0.48], [1, 0], [0.84, -0.58],
      [0.48, -0.91], [0, -1], [-0.5, -0.83], [-0.92, -0.35], [-0.95, 0.3],
      [-0.62, 0.82], [-0.2, 0.96],
    ].map(([x, y]) => [x * halfWidth, y * halfHeight]);
  }

  const count = 24;
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const taper = /arm|leg|hand|foot|thigh|calf/.test(lower)
      ? 0.78 + 0.22 * Math.abs(Math.sin(angle))
      : 0.94 + 0.06 * Math.cos(angle * 3);
    return [Math.cos(angle) * halfWidth * taper, Math.sin(angle) * halfHeight * taper];
  });
}

function createRegionSurfacePatch(
  scene: Object3D,
  name: string,
  center: [number, number, number],
  figurePosition: [number, number, number],
  figureScale: number,
  modelOffset: [number, number, number],
): [number, number, number][] {
  const [halfWidth, halfHeight] = regionScale(name);
  const contour = regionContour(name, halfWidth / figureScale, halfHeight / figureScale);
  const sourceContour = contour.map(([offsetX, offsetY]): ModelOffset => [
    center[0] + offsetX,
    center[1] + offsetY,
    center[2],
  ]);
  if (sourceContour.length < 3) return [];
  sourceContour.push(sourceContour[0]);
  const surface = /ear/.test(name.toLowerCase())
    ? "lateral"
    : /buttock/.test(name.toLowerCase())
      ? "posterior"
      : "anterolateral";
  const [projectedContour] = getSurfaceAnchoredPaths(
    scene,
    `physiology-region:${name}`,
    [sourceContour],
    surface,
    0.16,
  );
  return projectedContour.length >= 3
    ? projectedContour.map((point) => modelPointToWorld(point, figurePosition, figureScale, modelOffset))
    : [];
}

function createEyeSurfacePatches(
  scene: Object3D,
  figurePosition: [number, number, number],
  figureScale: number,
  modelOffset: [number, number, number],
): [number, number, number][][] {
  return [-1, 1].flatMap((side) => {
    const centerX = side * 0.026;
    const contour: ModelOffset[] = Array.from({ length: 28 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 28;
      const x = centerX + Math.cos(angle) * 0.026;
      const y = 1.92 + Math.sin(angle) * 0.018 + Math.cos(angle) * side * 0.002;
      const z = 0.095 + 0.02 * (1 - Math.min(1, Math.abs(x) / 0.13));
      return [x, y, z];
    });
    contour.push(contour[0]);
    const [projectedContour] = getSurfaceAnchoredPaths(
      scene,
      `physiology-eye-${side}`,
      [contour],
      "anterolateral",
      0.1,
    );
    return projectedContour.length >= 3
      ? [projectedContour.map((point) => modelPointToWorld(point, figurePosition, figureScale, modelOffset))]
      : [];
  });
}

function modelPointToWorld(
  point: [number, number, number],
  figurePosition: [number, number, number],
  figureScale: number,
  modelOffset: [number, number, number],
): [number, number, number] {
  return [
    MODEL_ROOT_POSITION[0] + figurePosition[0] + (point[0] + modelOffset[0]) * figureScale,
    MODEL_ROOT_POSITION[1] + figurePosition[1] + (point[1] + modelOffset[1]) * figureScale,
    MODEL_ROOT_POSITION[2] + figurePosition[2] + (point[2] + modelOffset[2]) * figureScale,
  ];
}

const DEFAULT_MODEL_CAMERA_POSITION: [number, number, number] = [
  MODEL_CAMERA_POSITION[0],
  MODEL_CAMERA_POSITION[1],
  MODEL_CAMERA_POSITION[2],
];
const DEFAULT_MODEL_CAMERA_TARGET: [number, number, number] = [
  MODEL_CAMERA_TARGET[0],
  MODEL_CAMERA_TARGET[1],
  MODEL_CAMERA_TARGET[2],
];
const BRAIN_CAMERA_POSITION: [number, number, number] = [0, 1.94, 0.75];
const BRAIN_CAMERA_TARGET: [number, number, number] = [0, 1.94, 0];

const NERVE_RIG_PATHS: Record<string, ModelAnchorName[][]> = {
  "Central nervous system": [["brain", "neck", "abdomen", "pelvis"]],
  "Peripheral nervous system": [["brain", "neck"], ["neck", "leftShoulder", "leftElbow", "leftHand"], ["neck", "rightShoulder", "rightElbow", "rightHand"], ["pelvis", "leftHip", "leftKnee", "leftAnkle"], ["pelvis", "rightHip", "rightKnee", "rightAnkle"]],
  "Somatic nervous system": [["neck", "leftShoulder", "leftElbow", "leftHand"], ["neck", "rightShoulder", "rightElbow", "rightHand"], ["pelvis", "leftHip", "leftKnee", "leftAnkle"], ["pelvis", "rightHip", "rightKnee", "rightAnkle"]],
  "Autonomic nervous system": [["neck", "chest", "abdomen", "pelvis"]],
  "Spinal cord": [["brain", "neck", "chest", "abdomen", "pelvis"]],
  "Corticospinal tract": [["brain", "neck", "chest", "abdomen", "pelvis"]],
  "Cervical spinal cord (C1–C8)": [["brain", "neck", "chest"]],
  "Thoracic spinal cord (T1–T12)": [["neck", "chest", "abdomen"]],
  "Lumbar spinal cord (L1–L5)": [["abdomen", "pelvis"]],
  "Sacral spinal cord (S1–S5)": [["pelvis", "leftHip"], ["pelvis", "rightHip"]],
  "Brachial plexus": [["neck", "leftShoulder"], ["neck", "rightShoulder"]],
  "Cervical plexus": [["head", "neck", "leftShoulder"], ["head", "neck", "rightShoulder"]],
  "Sacral plexus": [["pelvis", "leftHip"], ["pelvis", "rightHip"]],
  "Phrenic nerve": [["neck", "chest"]],
  "Radial nerve": [["leftShoulder", "leftElbow", "leftHand"], ["rightShoulder", "rightElbow", "rightHand"]],
  "Musculocutaneous nerve": [["leftShoulder", "leftElbow"], ["rightShoulder", "rightElbow"]],
  "Median nerve": [["leftElbow", "leftHand"], ["rightElbow", "rightHand"]],
  "Ulnar nerve": [["leftElbow", "leftHand"], ["rightElbow", "rightHand"]],
  "Femoral nerve": [["leftHip", "leftKnee"], ["rightHip", "rightKnee"]],
  "Obturator nerve": [["pelvis", "leftHip"], ["pelvis", "rightHip"]],
  "Sciatic nerve": [["leftHip", "leftKnee"], ["rightHip", "rightKnee"]],
  "Tibial nerve": [["leftKnee", "leftAnkle"], ["rightKnee", "rightAnkle"]],
  "Common fibular nerve": [["leftKnee", "leftAnkle"], ["rightKnee", "rightAnkle"]],
  "Vagus nerve pathway": [["head", "neck", "chest", "abdomen"]],
  "Superior laryngeal nerve": [["head", "neck"]],
  "Recurrent laryngeal nerve": [["neck", "chest"]],
};

function bilateralModelPaths(...paths: ModelOffset[][]): ModelOffset[][] {
  return paths.flatMap((path) => [1, -1].map((side) => path.map(([x, y, z]): ModelOffset => [x * side, y, z])));
}

function createLumbarPlexusPaths(): ModelOffset[][] {
  const paths: ModelOffset[][] = [];
  for (const side of [1, -1]) {
    // L1–L4 roots leave the lumbar column, merge within psoas, then divide
    // toward the femoral and obturator distributions.
    for (const [rootY, rootX] of [[1.24, 0.015], [1.19, 0.025], [1.14, 0.035], [1.09, 0.045]]) {
      paths.push([
        [side * rootX, rootY, 0.04],
        [side * (rootX + 0.02), rootY - 0.025, 0.06],
        [side * 0.075, 1.105, 0.075],
      ]);
    }
    paths.push([
      [side * 0.075, 1.105, 0.075],
      [side * 0.105, 1.01, 0.08],
      [side * 0.14, 0.89, 0.09],
      [side * 0.17, 0.72, 0.085],
    ]);
    paths.push([
      [side * 0.075, 1.105, 0.075],
      [side * 0.06, 1.005, 0.08],
      [side * 0.055, 0.89, 0.085],
      [side * 0.07, 0.77, 0.085],
    ]);
  }
  return paths;
}

// Cranial paths use source GLB coordinates: x is left/right, y is up, and z
// faces forward. This keeps each nerve on the head/neck instead of scaling a
// generic branch shape around a shared forehead focus point.
const CUSTOM_NERVE_PATHS: Record<string, ModelOffset[][]> = {
  "Cranial nerve I Olfactory": bilateralModelPaths(
    [[0.01, 1.98, -0.025], [0.015, 1.93, 0.025], [0.02, 1.89, 0.075]],
  ),
  "Cranial nerve II Optic": bilateralModelPaths(
    [[0.06, 1.81, 0.045], [0.04, 1.84, 0.015], [0, 1.85, -0.035]],
  ),
  "Cranial nerve III Oculomotor": bilateralModelPaths(
    [[0.025, 1.77, -0.11], [0.04, 1.8, -0.035], [0.055, 1.82, 0.055]],
  ),
  "Cranial nerve IV Trochlear": bilateralModelPaths(
    [[0.015, 1.77, -0.115], [0.04, 1.8, -0.045], [0.065, 1.81, 0.035]],
  ),
  "Cranial nerve V Trigeminal": bilateralModelPaths(
    [[0.025, 1.76, -0.05], [0.06, 1.75, 0.02], [0.07, 1.74, 0.08]],
    [[0.07, 1.74, 0.08], [0.055, 1.81, 0.13], [0.035, 1.86, 0.17]],
    [[0.07, 1.74, 0.08], [0.045, 1.75, 0.14], [0.02, 1.75, 0.18]],
    [[0.07, 1.74, 0.08], [0.05, 1.69, 0.14], [0.03, 1.67, 0.17]],
  ),
  "Cranial nerve VI Abducens": bilateralModelPaths(
    [[0.015, 1.75, -0.09], [0.03, 1.79, -0.015], [0.05, 1.82, 0.055]],
  ),
  "Cranial nerve VII Facial": bilateralModelPaths(
    // Sampled against the front of GhostBody, then offset 2.5 mm along the
    // surface normal so these branches stay on the cheek instead of cutting
    // through the head and appearing detached when viewed from the side.
    [
      [0.0722, 1.8393, 0.0722], [0.0725, 1.8482, 0.0778], [0.0729, 1.857, 0.0814],
      [0.0729, 1.8657, 0.0859], [0.0721, 1.8745, 0.0919], [0.0705, 1.8832, 0.0978],
      [0.0681, 1.892, 0.1019], [0.0651, 1.901, 0.1036], [0.062, 1.9095, 0.1027],
      [0.0588, 1.9172, 0.1025], [0.0544, 1.9246, 0.1045], [0.0498, 1.9305, 0.1121],
      [0.0458, 1.9391, 0.1186],
    ],
    [
      [0.0722, 1.8393, 0.0722], [0.0697, 1.846, 0.0828], [0.0671, 1.8526, 0.0907],
      [0.0645, 1.8591, 0.0978], [0.0614, 1.8656, 0.1044], [0.058, 1.872, 0.1097],
      [0.0542, 1.8783, 0.1137], [0.0502, 1.8845, 0.1161], [0.0459, 1.8906, 0.1172],
      [0.041, 1.8962, 0.1176], [0.036, 1.9012, 0.1175], [0.031, 1.9061, 0.1173],
      [0.0261, 1.9111, 0.1169],
    ],
    [
      [0.0722, 1.8393, 0.0722], [0.0683, 1.8392, 0.0819], [0.0643, 1.839, 0.0891],
      [0.0603, 1.839, 0.0952], [0.0564, 1.8395, 0.101], [0.0525, 1.8405, 0.1065],
      [0.0487, 1.8418, 0.111], [0.0448, 1.8432, 0.1147], [0.0407, 1.8444, 0.1176],
      [0.0366, 1.8454, 0.1197], [0.0328, 1.8461, 0.1209], [0.0298, 1.8472, 0.1232],
      [0.0264, 1.8487, 0.1271],
    ],
    [
      [0.0722, 1.8393, 0.0722], [0.071, 1.8338, 0.0701], [0.0699, 1.8283, 0.0649],
      [0.0687, 1.8236, 0.0213], [0.0669, 1.8183, 0.0247], [0.0647, 1.8133, 0.0284],
      [0.0621, 1.8085, 0.0328], [0.0595, 1.8037, 0.0361], [0.057, 1.7991, 0.0392],
      [0.0545, 1.7941, 0.0419], [0.052, 1.7892, 0.0441], [0.0494, 1.7845, 0.0466],
      [0.047, 1.7796, 0.0484],
    ],
  ),
  "Cranial nerve VIII Vestibulocochlear": bilateralModelPaths(
    [[0.03, 1.73, -0.085], [0.075, 1.76, -0.045], [0.13, 1.78, -0.02]],
  ),
  "Cranial nerve IX Glossopharyngeal": bilateralModelPaths(
    [[0.02, 1.68, -0.065], [0.045, 1.65, -0.015], [0.065, 1.59, 0.045]],
  ),
  "Cranial nerve X Vagus": bilateralModelPaths(
    [[0.015, 1.67, -0.065], [0.035, 1.62, -0.025], [0.045, 1.52, 0.005], [0.05, 1.4, -0.015]],
  ),
  "Cranial nerve XI Accessory": bilateralModelPaths(
    [[0.015, 1.67, -0.07], [0.055, 1.6, -0.045], [0.13, 1.55, -0.035], [0.24, 1.53, -0.045]],
  ),
  "Cranial nerve XII Hypoglossal": bilateralModelPaths(
    [[0.015, 1.68, -0.07], [0.02, 1.64, 0.005], [0.045, 1.61, 0.075]],
  ),
  "Superior gluteal nerve": bilateralModelPaths(
    // The nerve exits above piriformis, then divides over gluteus medius and
    // toward tensor fasciae latae. Keep every branch on the upper buttock.
    [[0.045, 0.965, -0.09], [0.07, 0.94, -0.11], [0.105, 0.96, -0.125]],
    [[0.105, 0.96, -0.125], [0.14, 1.005, -0.13], [0.165, 1.045, -0.12]],
    [[0.105, 0.96, -0.125], [0.145, 0.98, -0.135], [0.175, 1.0, -0.12]],
    [[0.09, 0.955, -0.12], [0.13, 0.93, -0.105], [0.165, 0.91, -0.08]],
  ),
  "Inferior gluteal nerve": bilateralModelPaths(
    // This nerve enters the deep surface of gluteus maximus and stays above
    // the gluteal fold; it does not continue down the posterior thigh.
    [[0.04, 0.91, -0.095], [0.075, 0.885, -0.12], [0.11, 0.87, -0.135]],
    [[0.11, 0.87, -0.135], [0.145, 0.845, -0.135], [0.16, 0.805, -0.12]],
    [[0.11, 0.87, -0.135], [0.115, 0.825, -0.14], [0.12, 0.785, -0.125]],
    [[0.11, 0.87, -0.135], [0.075, 0.835, -0.135], [0.07, 0.795, -0.12]],
  ),
  "Lumbar plexus": createLumbarPlexusPaths(),
  "Femoral nerve": bilateralModelPaths(
    [[0.07, 1.08, 0.055], [0.105, 0.98, 0.075], [0.12, 0.87, 0.095], [0.135, 0.75, 0.1], [0.145, 0.61, 0.095], [0.15, 0.45, 0.075]],
  ),
  "Obturator nerve": bilateralModelPaths(
    [[0.055, 1.08, 0.055], [0.065, 0.98, 0.075], [0.06, 0.86, 0.085], [0.055, 0.73, 0.09], [0.05, 0.59, 0.085]],
  ),
  "Sciatic nerve": bilateralModelPaths(
    [[0.045, 0.93, -0.07], [0.08, 0.88, -0.12], [0.105, 0.81, -0.145], [0.11, 0.68, -0.15], [0.11, 0.54, -0.14], [0.105, 0.42, -0.12]],
  ),
  "Tibial nerve": bilateralModelPaths(
    [[0.105, 0.42, -0.12], [0.11, 0.32, -0.11], [0.11, 0.22, -0.1], [0.11, 0.12, -0.07], [0.11, 0.045, -0.035]],
  ),
  "Common fibular nerve": bilateralModelPaths(
    [[0.105, 0.42, -0.12], [0.13, 0.405, -0.1], [0.155, 0.37, -0.07], [0.15, 0.29, -0.055], [0.145, 0.2, -0.04]],
  ),
};

const ANATOMY_NERVE_PATHS: Record<string, ModelOffset[][]> = {
  ...CUSTOM_NERVE_PATHS,
  ...SPINAL_CORD_PATHS,
  ...AUTONOMIC_PATHWAYS,
  ...CRANIAL_NERVE_PATHS,
  ...NEUROMUSCULAR_JUNCTION_PATHS,
  "Common fibular nerve": COMMON_FIBULAR_NERVE_PATHS,
  // Preserve the already surface-mapped facial branches, which were recently
  // corrected and visually approved; the new cranial map supplies the other
  // cranial routes, including the vagus course into the chest.
  "Cranial nerve VII Facial": CUSTOM_NERVE_PATHS["Cranial nerve VII Facial"],
};

const surfaceAnchorCache = new Map<
  string,
  { position: [number, number, number]; normal: [number, number, number] } | null
>();

function RendererSizeSync() {
  const { gl, camera } = useThree();

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;

    const syncSize = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (!width || !height) return;
      gl.setSize(width, height, false);
      if ("aspect" in camera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(parent);
    window.addEventListener("resize", syncSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, [gl, camera]);

  return null;
}

function ModelScrollRotation({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  const { controlsRef } = useModel3D();

  useEffect(() => {
    if (!enabled) return;
    return attachModelWheelRotation(gl.domElement, () => controlsRef.current);
  }, [controlsRef, enabled, gl.domElement]);

  return null;
}

function CameraFocusController({
  brainFocused,
  initialCameraPosition,
  initialCameraTarget,
}: {
  brainFocused: boolean;
  initialCameraPosition: [number, number, number];
  initialCameraTarget: [number, number, number];
}) {
  const { camera, invalidate, size } = useThree();
  const { controlsRef, selectedArea } = useModel3D();
  const areaTarget = selectedArea && selectedArea.meshName !== "brain" ? selectedArea.target : null;
  const upperLimbNerveCameraFocus = selectedArea?.highlightType === "nerve" && areaTarget
    ? getUpperLimbNerveCameraFocus(selectedArea.name, areaTarget)
    : null;
  const facialMuscleFocused = selectedArea !== null && (
    selectedArea.name in FACIAL_MUSCLE_SHAPES
    || selectedArea.name in LOWER_FACIAL_MUSCLE_PATHS
  );
  const hipThighOverlay = selectedArea ? HIP_THIGH_MUSCLE_PATHS[selectedArea.name] : undefined;
  const hipThighMuscleFocused = Boolean(hipThighOverlay);
  const lowerLegFootOverlay = selectedArea ? LOWER_LEG_FOOT_MUSCLE_PATHS[selectedArea.name] : undefined;
  const lowerLegFootMuscleFocused = Boolean(lowerLegFootOverlay);
  const upperLimbMuscleOverlay = selectedArea ? UPPER_LIMB_MUSCLE_PATHS[selectedArea.name] : undefined;
  const upperLimbMuscleFocused = Boolean(upperLimbMuscleOverlay);
  const laryngealOverlay = selectedArea ? LARYNGEAL_MUSCLE_PATHS[selectedArea.name] : undefined;
  const laryngealMuscleFocused = Boolean(laryngealOverlay);
  const throatSwallowingOverlay = selectedArea ? THROAT_SWALLOWING_MUSCLE_PATHS[selectedArea.name] : undefined;
  const throatSwallowingMuscleFocused = Boolean(throatSwallowingOverlay);
  const tongueMuscleOverlay = selectedArea ? TONGUE_MUSCLE_PATHS[selectedArea.name] : undefined;
  const skinSensationOverlay = selectedArea ? SKIN_SENSATION_PATHS[selectedArea.name] : undefined;
  const sensoryPathwayView = selectedArea && selectedArea.name in SENSORY_PATHWAY_VIEWS
    ? SENSORY_PATHWAY_VIEWS[selectedArea.name as keyof typeof SENSORY_PATHWAY_VIEWS]
    : undefined;
  const autonomicPathwayView = selectedArea && selectedArea.name in AUTONOMIC_PATHWAY_VIEWS
    ? AUTONOMIC_PATHWAY_VIEWS[selectedArea.name]
    : undefined;
  const sensoryPathwayFocused = Boolean(sensoryPathwayView);
  const upperLimbFocus = selectedArea ? getUpperLimbMuscleCameraFocus(selectedArea.name, size.width / size.height) : null;
  const neuromuscularJunctionFocused = selectedArea?.name === "Neuromuscular junction";
  const facialNerveFocused = selectedArea?.highlightType === "nerve"
    && (/cranial nerve (?:III|IV|V|VI|VII|XII)\b/i.test(selectedArea.name)
      || selectedArea.name === "Nasal sensory nerves (V1/V2)");
  const cranialTrunkFocused = selectedArea?.highlightType === "nerve"
    && /cranial nerve (?:IX|X|XI)\b/i.test(selectedArea.name);
  const posteriorCranialTrunkFocused = cranialTrunkFocused
    && /cranial nerve XI\b/i.test(selectedArea?.name ?? "");
  const faceFocused = facialMuscleFocused || facialNerveFocused;
  const posteriorNerveFocused = selectedArea?.highlightType === "nerve"
    && /sciatic|gluteal|tibial|sacral plexus|spinal cord|corticospinal|central nervous system|dorsal root/i.test(selectedArea.name);
  const regionalNerveFocused = selectedArea?.highlightType === "nerve"
    && /common fibular nerve|spinal cord|corticospinal tract|central nervous system/i.test(selectedArea.name);
  const posteriorMuscleFocused = hipThighOverlay?.surface === "posterior"
    || lowerLegFootOverlay?.cameraSurface === "posterior";

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const target = brainFocused
      ? BRAIN_CAMERA_TARGET
      : upperLimbNerveCameraFocus
        ? upperLimbNerveCameraFocus.target
      : upperLimbFocus
        ? upperLimbFocus.target
      : laryngealOverlay && areaTarget
        ? [areaTarget[0], areaTarget[1] + .015, areaTarget[2]]
      : throatSwallowingOverlay && areaTarget
        ? [areaTarget[0], areaTarget[1], areaTarget[2]]
      : tongueMuscleOverlay && areaTarget
        ? [areaTarget[0], areaTarget[1], areaTarget[2]]
      : skinSensationOverlay && areaTarget
        ? [areaTarget[0] + skinSensationOverlay.cameraTargetOffsetX, areaTarget[1], areaTarget[2]]
      : sensoryPathwayView && areaTarget
        ? [areaTarget[0], areaTarget[1] + (sensoryPathwayView.cameraTargetOffsetY ?? 0), areaTarget[2]]
      : autonomicPathwayView && areaTarget
        ? [areaTarget[0], areaTarget[1] + (autonomicPathwayView.cameraTargetOffsetY ?? 0), areaTarget[2]]
      : areaTarget
        ? [areaTarget[0], areaTarget[1] + (facialNerveFocused ? .1 : cranialTrunkFocused || regionalNerveFocused ? .02 : lowerLegFootMuscleFocused ? .015 : 0), areaTarget[2]]
        : initialCameraTarget;
    const position: [number, number, number] = brainFocused
      ? BRAIN_CAMERA_POSITION
      : upperLimbNerveCameraFocus
        ? upperLimbNerveCameraFocus.position
      : upperLimbFocus
        ? upperLimbFocus.position
      : laryngealOverlay && areaTarget
        ? [
            areaTarget[0],
            areaTarget[1] + .015,
            areaTarget[2] + (laryngealOverlay.cameraSurface === "posterior" ? -laryngealOverlay.cameraDistance : laryngealOverlay.cameraDistance),
          ]
      : throatSwallowingOverlay && areaTarget
        ? [
            areaTarget[0],
            areaTarget[1] + throatSwallowingOverlay.cameraVerticalOffset,
            areaTarget[2] + throatSwallowingOverlay.cameraDistance,
          ]
      : tongueMuscleOverlay && areaTarget
        ? [areaTarget[0], areaTarget[1], areaTarget[2] + tongueMuscleOverlay.cameraDistance]
      : skinSensationOverlay && areaTarget
        ? [
            target[0],
            areaTarget[1],
            areaTarget[2] + (skinSensationOverlay.cameraSurface === "posterior" ? -skinSensationOverlay.cameraDistance : skinSensationOverlay.cameraDistance),
          ]
      : sensoryPathwayView && areaTarget
        ? [
            areaTarget[0],
            areaTarget[1] + (sensoryPathwayView.cameraTargetOffsetY ?? 0),
            areaTarget[2] + (sensoryPathwayView.cameraSurface === "posterior" ? -sensoryPathwayView.cameraDistance : sensoryPathwayView.cameraDistance),
          ]
      : autonomicPathwayView && areaTarget
        ? [
            areaTarget[0],
            areaTarget[1] + (autonomicPathwayView.cameraTargetOffsetY ?? 0),
            areaTarget[2] + (autonomicPathwayView.cameraSurface === "posterior" ? -autonomicPathwayView.cameraDistance : autonomicPathwayView.cameraDistance),
          ]
      : areaTarget
        ? [
            areaTarget[0] + (lowerLegFootOverlay?.cameraSurface === "lateral" ? .72 : 0),
            areaTarget[1] + (lowerLegFootOverlay?.cameraSurface === "plantar" ? -1.05 : faceFocused ? facialNerveFocused ? .12 : .02 : neuromuscularJunctionFocused ? .02 : hipThighMuscleFocused ? .035 : lowerLegFootMuscleFocused ? .02 : .12),
            areaTarget[2] + (lowerLegFootMuscleFocused
              ? lowerLegFootOverlay?.cameraSurface === "posterior" ? -1.05 : lowerLegFootOverlay?.cameraSurface === "lateral" ? .42 : lowerLegFootOverlay?.cameraSurface === "plantar" ? .18 : .68
              : facialMuscleFocused ? .82
              : facialNerveFocused ? 1.2
                : neuromuscularJunctionFocused ? .95
                : hipThighMuscleFocused ? posteriorMuscleFocused ? -(hipThighOverlay?.cameraDistance ?? 1.55) : (hipThighOverlay?.cameraDistance ?? 1.55)
                  : cranialTrunkFocused ? posteriorCranialTrunkFocused ? -1.9 : 1.9
                    : regionalNerveFocused ? posteriorNerveFocused ? -2.05 : 1.55
                      : posteriorNerveFocused ? -2.6 : 2.6),
          ]
        : initialCameraPosition;
    const targetFov = brainFocused ? 32 : upperLimbNerveCameraFocus ? upperLimbNerveCameraFocus.fov : upperLimbFocus ? upperLimbFocus.fov : laryngealMuscleFocused ? 32 : throatSwallowingMuscleFocused ? (throatSwallowingOverlay?.cameraFov ?? 38) : tongueMuscleOverlay ? tongueMuscleOverlay.cameraFov : skinSensationOverlay ? skinSensationOverlay.cameraFov : sensoryPathwayView ? sensoryPathwayView.cameraFov : autonomicPathwayView ? autonomicPathwayView.cameraFov : faceFocused ? 30 : lowerLegFootOverlay?.cameraSurface === "plantar" ? 34 : neuromuscularJunctionFocused ? 38
      : hipThighMuscleFocused || lowerLegFootMuscleFocused || cranialTrunkFocused || regionalNerveFocused ? 38 : MODEL_FOV;
    const previouslyEnabled = controls.enabled;
    controls.enabled = false;
    gsap.killTweensOf(controls.target);
    gsap.killTweensOf(controls.object.position);
    gsap.killTweensOf(camera);

    const keepViewAligned = () => {
      camera.lookAt(controls.target);
      invalidate();
    };
    const duration = .24;
    gsap.to(controls.target, {
      x: target[0], y: target[1], z: target[2], duration, ease: "power2.out",
      onUpdate: keepViewAligned,
    });
    gsap.to(controls.object.position, {
      x: position[0], y: position[1], z: position[2], duration, ease: "power2.out",
      onUpdate: keepViewAligned,
      onComplete: () => {
        controls.enabled = previouslyEnabled;
        controls.update();
        invalidate();
      },
    });
    if (camera instanceof PerspectiveCamera) {
      gsap.to(camera, {
        fov: targetFov, duration, ease: "power2.out",
        onUpdate: () => { camera.updateProjectionMatrix(); invalidate(); },
      });
    }

    return () => {
      gsap.killTweensOf(controls.target);
      gsap.killTweensOf(controls.object.position);
      gsap.killTweensOf(camera);
      controls.enabled = previouslyEnabled;
    };
  }, [
    areaTarget?.[0], areaTarget?.[1], areaTarget?.[2], faceFocused, posteriorNerveFocused, sensoryPathwayFocused,
    hipThighMuscleFocused, hipThighOverlay?.cameraDistance, laryngealMuscleFocused, laryngealOverlay?.cameraSurface, laryngealOverlay?.cameraDistance, throatSwallowingMuscleFocused, throatSwallowingOverlay?.cameraDistance, throatSwallowingOverlay?.cameraFov, throatSwallowingOverlay?.cameraVerticalOffset, tongueMuscleOverlay?.cameraDistance, tongueMuscleOverlay?.cameraFov, skinSensationOverlay?.cameraSurface, skinSensationOverlay?.cameraDistance, skinSensationOverlay?.cameraFov, skinSensationOverlay?.cameraTargetOffsetX, neuromuscularJunctionFocused, posteriorMuscleFocused, cranialTrunkFocused, posteriorCranialTrunkFocused,
    regionalNerveFocused, lowerLegFootMuscleFocused, lowerLegFootOverlay?.cameraSurface,
    upperLimbMuscleFocused, upperLimbMuscleOverlay?.cameraSurface, sensoryPathwayView?.cameraSurface, sensoryPathwayView?.cameraDistance, sensoryPathwayView?.cameraFov, sensoryPathwayView?.cameraTargetOffsetY, autonomicPathwayView?.cameraSurface, autonomicPathwayView?.cameraDistance, autonomicPathwayView?.cameraFov, autonomicPathwayView?.cameraTargetOffsetY, selectedArea?.name, size.width, size.height,
    upperLimbNerveCameraFocus?.fov,
    brainFocused, camera, controlsRef, initialCameraPosition, initialCameraTarget, invalidate,
  ]);

  return null;
}

function createRegionPatchGeometry(surfacePatch: [number, number, number][], outline = false): BufferGeometry | null {
  if (surfacePatch.length < 3) return null;
  const contour = surfacePatch.length > 3
    && new Vector3(...surfacePatch[0]).distanceTo(new Vector3(...surfacePatch[surfacePatch.length - 1])) < 0.0001
    ? surfacePatch.slice(0, -1)
    : surfacePatch;
  const points = contour.map((point) => new Vector3(...worldToModelLocal(point)));
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => positions.set([point.x, point.y, point.z], index * 3));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (outline) {
    geometry.setIndex(points.map((_, index) => index));
    return geometry;
  }

  const contour2d = points.map((point) => new Vector2(point.x, point.y));
  geometry.setIndex(ShapeUtils.triangulateShape(contour2d, []).flat());
  geometry.computeVertexNormals();
  return geometry;
}

function createMuscleRibbonGeometry(
  sourcePoints: [number, number, number][],
  halfWidth: number,
  closed = false,
  surfaceNormal = new Vector3(0, 0, 1),
): BufferGeometry {
  const points = closed && sourcePoints.length > 2
    && new Vector3(...sourcePoints[0]).distanceTo(new Vector3(...sourcePoints[sourcePoints.length - 1])) < 0.0001
    ? sourcePoints.slice(0, -1)
    : sourcePoints;
  const curve = new CatmullRomCurve3(points.map((point) => new Vector3(...point)), closed, "centripetal");
  const segments = Math.max(closed ? 24 : 16, points.length * 10);
  const vertexCount = closed ? segments : segments + 1;
  const positions = new Float32Array(vertexCount * 6);
  const indices: number[] = [];

  for (let index = 0; index < vertexCount; index += 1) {
    const t = index / segments;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const across = surfaceNormal.clone().cross(tangent);
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
    const taper = closed ? 1 : Math.max(0.06, Math.sin(Math.PI * t) ** 0.65);
    across.normalize().multiplyScalar(halfWidth * taper);
    const left = center.clone().add(across);
    const right = center.clone().sub(across);
    const offset = index * 6;
    positions.set([left.x, left.y, left.z, right.x, right.y, right.z], offset);

    if (index < vertexCount - 1 || closed) {
      const next = (index + 1) % vertexCount;
      const currentVertex = index * 2;
      const nextVertex = next * 2;
      indices.push(currentVertex, currentVertex + 1, nextVertex, currentVertex + 1, nextVertex + 1, nextVertex);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSurfaceDrapedMuscleRibbonGeometry(
  edges: { left: [number, number, number][]; right: [number, number, number][] },
): BufferGeometry {
  const vertexCount = Math.min(edges.left.length, edges.right.length);
  const positions = new Float32Array(vertexCount * 6);
  const indices: number[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 6;
    positions.set([...edges.left[index], ...edges.right[index]], offset);
    if (index < vertexCount - 1) {
      const currentVertex = index * 2;
      const nextVertex = (index + 1) * 2;
      indices.push(currentVertex, currentVertex + 1, nextVertex, currentVertex + 1, nextVertex + 1, nextVertex);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createMusclePatchGeometry(sourcePoints: [number, number, number][]): BufferGeometry {
  const points = sourcePoints.map((point) => new Vector3(...point));
  const contour = points.map((point) => new Vector2(point.x, point.y));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => positions.set([point.x, point.y, point.z], index * 3));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  return geometry;
}

function FacialMuscleHighlight({ area, onSelect }: { area: Area; onSelect?: (area: Area) => void }) {
  const ribbons = useMemo(() => (area.muscleRibbons ?? []).map(({ points, halfWidth, closed, surfaceNormal, surfaceEdges, glowSurfaceEdges }) => {
    const localPoints = points.map(worldToModelLocal);
    const normal = new Vector3(...(surfaceNormal ?? [0, 0, 1]));
    return {
      glow: glowSurfaceEdges
        ? createSurfaceDrapedMuscleRibbonGeometry({
          left: glowSurfaceEdges.left.map(worldToModelLocal),
          right: glowSurfaceEdges.right.map(worldToModelLocal),
        })
        : createMuscleRibbonGeometry(localPoints, halfWidth * 1.55, closed, normal),
      fill: surfaceEdges
        ? createSurfaceDrapedMuscleRibbonGeometry({
          left: surfaceEdges.left.map(worldToModelLocal),
          right: surfaceEdges.right.map(worldToModelLocal),
        })
        : createMuscleRibbonGeometry(localPoints, halfWidth, closed, normal),
    };
  }), [area.muscleRibbons]);
  const patches = useMemo(() => (area.musclePatches ?? []).map((points) =>
    createMusclePatchGeometry(points.map(worldToModelLocal)),
  ), [area.musclePatches]);
  useEffect(() => () => {
    ribbons.forEach(({ glow, fill }) => { glow.dispose(); fill.dispose(); });
    patches.forEach((patch) => patch.dispose());
  }, [patches, ribbons]);

  return (
    <group onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(area); } : undefined}>
      {patches.map((patch, index) => <mesh key={`patch-${index}`} geometry={patch} renderOrder={20}>
        <meshBasicMaterial color="#35d9ff" transparent opacity={0.06} depthTest={Boolean(area.surfaceAnchored)} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>)}
      {ribbons.map(({ glow, fill }, index) => <group key={index}>
        <mesh geometry={glow} renderOrder={20}>
          <meshBasicMaterial color="#28cfff" transparent opacity={0.08} depthTest={Boolean(area.surfaceAnchored)} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
        <mesh geometry={fill} renderOrder={21}>
          <meshBasicMaterial color="#35d9ff" transparent opacity={0.25} depthTest={Boolean(area.surfaceAnchored)} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
      </group>)}
    </group>
  );
}

function regionScale(name: string): [number, number, number] {
  const lower = name.toLowerCase();
  if (/neuromuscular junction|motor end plate/.test(lower)) return [0.018, 0.025, 0.008];
  if (/^head$/.test(lower)) return [0.105, 0.09, 0.012];
  if (/^face$/.test(lower)) return [0.075, 0.105, 0.012];
  if (/ear/.test(lower)) return [0.024, 0.058, 0.012];
  if (/eye|mouth|jaw|brow|eyelid/.test(lower)) return [0.042, 0.056, 0.012];
  if (/arm|forearm|biceps|triceps|hand|finger|wrist|palm/.test(lower)) return [0.05, 0.10, 0.014];
  if (/leg|thigh|calf|knee|foot|ankle|toe|glute|buttock/.test(lower)) return [0.055, 0.11, 0.016];
  if (/torso|chest|back|abdomen|stomach|heart|diaphragm/.test(lower)) return [0.085, 0.095, 0.017];
  if (/throat|larynx|tongue|vocal/.test(lower)) return [0.035, 0.05, 0.012];
  return [0.05, 0.07, 0.014];
}

function RegionHighlight({ area, onSelect }: { area: Area; onSelect?: (area: Area) => void }) {
  const regionPatches = area.regionPatches ?? (area.regionPatch ? [area.regionPatch] : []);
  const geometries = useMemo(() => regionPatches.map((patch) => ({
    fill: createRegionPatchGeometry(patch),
    outline: createRegionPatchGeometry(patch, true),
  })), [regionPatches]);
  useEffect(() => () => {
    geometries.forEach(({ fill, outline }) => {
      fill?.dispose();
      outline?.dispose();
    });
  }, [geometries]);
  const validGeometries = geometries.filter((geometry): geometry is { fill: BufferGeometry; outline: BufferGeometry } => Boolean(geometry.fill && geometry.outline));
  if (!validGeometries.length) return null;
  return (
    <group onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(area); } : undefined}>
      {validGeometries.map(({ fill, outline }, index) => <group key={index}>
        <mesh geometry={fill} renderOrder={20}>
          <meshBasicMaterial color="#19cfff" transparent opacity={0.34} depthTest depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
        <lineLoop geometry={outline} renderOrder={21}>
          <lineBasicMaterial color="#00bff4" transparent opacity={0.8} depthTest toneMapped={false} />
        </lineLoop>
      </group>)}
    </group>
  );
}

function NerveHighlight({ area, onSelect }: { area: Area; onSelect?: (area: Area) => void }) {
  const riggedPath = Boolean(area.markerPaths?.length || (area.markerPositions?.length ?? 0) > 1);
  const center = riggedPath ? [0, 0, 0] as [number, number, number] : worldToModelLocal(area.markerPosition ?? area.target);
  const surfaceAnchoredNerve = area.name === "Cranial nerve VII Facial"
    || area.name === "Common fibular nerve"
    || Boolean(area.surfaceAnchored);
  const paths = useMemo(() => {
    const riggedPaths = area.markerPaths ?? (area.markerPositions && area.markerPositions.length > 1 ? [area.markerPositions] : null);
    if (riggedPaths) {
      const cranialNerve = area.name.startsWith("Cranial nerve");
      const commonFibularNerve = area.name === "Common fibular nerve";
      const skinSensationNerve = area.name in SKIN_SENSATION_PATHS;
      const cutaneousReceptors = area.name === "Cutaneous receptors";
      const glowRadius = cranialNerve ? 0.0012 : commonFibularNerve ? 0.0018 : cutaneousReceptors ? 0.005 : skinSensationNerve ? 0.003 : 0.0028;
      const coreRadius = cranialNerve ? 0.0005 : commonFibularNerve ? 0.0008 : cutaneousReceptors ? 0.0018 : skinSensationNerve ? 0.001 : 0.001;
      return riggedPaths.map((points) => {
        const curve = new CatmullRomCurve3(points.map((point) => new Vector3(...worldToModelLocal(point))));
        return {
          glow: new TubeGeometry(curve, Math.max(18, points.length * 8), glowRadius, 6, false),
          core: new TubeGeometry(curve, Math.max(18, points.length * 8), coreRadius, 6, false),
        };
      });
    }
    const centralNervousSystem = area.name === "Central nervous system";
    if (centralNervousSystem) {
      const curve = new CatmullRomCurve3([
        new Vector3(0, 0, 0),
        new Vector3(0.006, -0.28, -0.01),
        new Vector3(-0.004, -0.62, -0.015),
        new Vector3(0, -1.02, -0.01),
      ]);
      return [{
        glow: new TubeGeometry(curve, 32, 0.0035, 8, false),
        core: new TubeGeometry(curve, 32, 0.0013, 8, false),
      }];
    }
    const lowerLimb = /sciatic|femoral|tibial|fibular|sural|saphenous|sacral|lumbar|leg|foot/i.test(area.name);
    const upperLimb = /brachial|radial|ulnar|median|musculocutaneous|hand|arm/i.test(area.name);
    const length = lowerLimb ? 0.42 : upperLimb ? 0.34 : 0.24;
    const branch = lowerLimb ? 0.11 : upperLimb ? 0.09 : 0.075;
    const yDir = lowerLimb ? -1 : 1;
    const definitions: [number, number, number][][] = [
      [[0, length * yDir, 0], [0.015, length * 0.48 * yDir, 0.005], [0, 0, 0.012], [-0.012, -length * 0.48 * yDir, 0.006], [0, -length * yDir, 0]],
      [[0, 0, 0.012], [branch, length * 0.15 * yDir, 0.01], [branch * 1.45, length * 0.34 * yDir, 0.006]],
      [[0, -length * 0.12 * yDir, 0.014], [-branch, -length * 0.26 * yDir, 0.009], [-branch * 1.35, -length * 0.43 * yDir, 0.004]],
    ];
    return definitions.map((points, index) => {
      const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)));
      return {
        glow: new TubeGeometry(curve, 20, index === 0 ? 0.0028 : 0.0022, 6, false),
        core: new TubeGeometry(curve, 20, index === 0 ? 0.001 : 0.0008, 6, false),
      };
    });
  }, [area.markerPaths, area.markerPositions, area.name]);
  useEffect(() => () => paths.forEach(({ glow, core }) => { glow.dispose(); core.dispose(); }), [paths]);
  const orientation = useMemo(() => new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, 1),
    new Vector3(...(riggedPath ? [0, 0, 1] : area.surfaceNormal ?? [0, 0, 1])).normalize(),
  ), [area.surfaceNormal, riggedPath]);
  return (
    <group position={center} quaternion={orientation} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(area); } : undefined}>
      {paths.map(({ glow, core }, index) => <group key={index}>
        <mesh geometry={glow} renderOrder={20}>
          <meshBasicMaterial color="#28cfff" transparent opacity={index === 0 ? 0.22 : 0.16} depthTest={surfaceAnchoredNerve} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh geometry={core} renderOrder={21}>
          <meshBasicMaterial color="#a8f4ff" transparent opacity={index === 0 ? 1 : 0.9} depthTest={surfaceAnchoredNerve} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>)}
    </group>
  );
}

function BrainRegionHighlight({ area }: { area: Area }) {
  const geometry = useMemo(createBrainRegionBlobGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const positions = area.markerPositions ?? [area.markerPosition ?? [0, 0, 0]];
  const lower = area.name.toLowerCase();
  const scale: [number, number, number] = /frontal lobe/.test(lower)
    ? [0.03, 0.015, 0.006]
    : /parietal lobe/.test(lower)
      ? [0.025, 0.014, 0.006]
      : /temporal lobe/.test(lower)
        ? [0.015, 0.023, 0.006]
        : /occipital lobe/.test(lower)
          ? [0.02, 0.015, 0.006]
    : /brainstem|midbrain|pons|medulla/.test(lower)
      ? [0.012, 0.028, 0.007]
      : /cerebellum/.test(lower)
        ? [0.024, 0.018, 0.007]
        : /cortex/.test(lower)
          ? [0.018, 0.011, 0.006]
          : [0.013, 0.018, 0.006];
  return (
    <>
      {positions.map((position, index) => (
        <group key={`${area.name}:${index}`} position={position} scale={scale} renderOrder={20}>
          <mesh geometry={geometry} renderOrder={20}>
            <meshBasicMaterial color="#00dfff" transparent opacity={0.58} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh geometry={geometry} scale={1.12} renderOrder={19}>
            <meshBasicMaterial color="#00bfff" transparent opacity={0.1} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function AreaMarker({ selectedArea, onSelect }: { selectedArea: Area; onSelect?: (area: Area) => void }) {
  if (selectedArea.meshName === "brain") return <BrainRegionHighlight area={selectedArea} />;
  if (selectedArea.muscleRibbons?.length) return <FacialMuscleHighlight area={selectedArea} onSelect={onSelect} />;
  if (selectedArea.highlightType === "nerve") return <NerveHighlight area={selectedArea} onSelect={onSelect} />;
  return <RegionHighlight area={selectedArea} onSelect={onSelect} />;
}

function HotspotMarker({
  hotspot,
  onClick,
  isSelected,
  isMultiSelected,
}: {
  hotspot: any;
  onClick: () => void;
  isSelected: boolean;
  isMultiSelected: boolean;
}) {
  const theme = useTheme() as any;
  const size = hotspot.size === "large" ? 0.08 : 0.02;
  const baseColor = hotspot.size === "large" ? theme.primary : "#ffaa00";
  const color = isMultiSelected
    ? "#ff6b6b"
    : isSelected
      ? "#ffffff"
      : baseColor;

  return (
    <group position={hotspot.position}>
      <mesh onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
        />
      </mesh>
      {isSelected && (
        <group position={[0, size + 0.05, 0]}>
          <mesh>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshStandardMaterial
              color="#ffaa00"
              emissive="#ffaa00"
              emissiveIntensity={0.8}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

function PersonModel({
  selectedArea,
  isEditMode,
  onAddHotspot,
  modelUrl,
  modelOffset,
  showSelectionHalo,
  showAnatomyBrain,
  brainFocused,
  physiologyClickToFocus,
  physiologyAreas,
  visibleAreas,
  onAreaSelect,
  children,
}: {
  selectedArea: Area | null;
  isEditMode: boolean;
  onAddHotspot: (point: Vector3) => void;
  modelUrl: string;
  modelOffset: [number, number, number];
  showSelectionHalo: boolean;
  showAnatomyBrain: boolean;
  brainFocused: boolean;
  physiologyClickToFocus: boolean;
  physiologyAreas: Area[];
  visibleAreas?: Area[];
  onAreaSelect?: (area: Area) => void;
  children?: React.ReactNode;
}) {
  const { scene } = useGLTF(modelUrl);
  useEffect(() => { prepareMuscleProjection(scene); }, [scene]);
  const figureTransform = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(scene);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const scale = size.y > 0 ? 1.9 / size.y : 1;
    const brainPosition = resolveModelAnchor(scene, "brain") ?? [center.x, bounds.max.y - size.y * 0.15, center.z];
    return {
      position: [-center.x * scale, -center.y * scale, -center.z * scale] as [number, number, number],
      scale,
      brainPosition: brainPosition as [number, number, number],
    };
  }, [scene]);
  const physiologySourceAreas = useMemo(() => physiologyAreas.map((area) => ({
    ...area,
    position: physiologySourceCenter(area.name, scene)
      ?? sourcePointFromWorld(area.position, figureTransform.position, figureTransform.scale, modelOffset),
  })), [figureTransform, modelOffset, physiologyAreas, scene]);
  const anatomyScene = useMemo(
    () => showAnatomyBrain ? createAnatomyFigureScene(scene) : null,
    [scene, showAnatomyBrain],
  );
  useEffect(() => {
    if (!anatomyScene) return;
    const bodySurface = anatomyScene.getObjectByName("GhostBody");
    if (!bodySurface) return;
    const writeDepth = selectedArea?.name === "Common fibular nerve"
      || Boolean(selectedArea && (
        LOWER_LEG_FOOT_MUSCLE_PATHS[selectedArea.name]
        || UPPER_LIMB_MUSCLE_PATHS[selectedArea.name]
        || LARYNGEAL_MUSCLE_PATHS[selectedArea.name]
        || THROAT_SWALLOWING_MUSCLE_PATHS[selectedArea.name]
        || TONGUE_MUSCLE_PATHS[selectedArea.name]
        || SKIN_SENSATION_PATHS[selectedArea.name]
        || HIP_THIGH_MUSCLE_PATHS[selectedArea.name]?.surfaceAnchored
      ));
    bodySurface.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        material.depthWrite = writeDepth;
        material.needsUpdate = true;
      });
    });
  }, [anatomyScene, selectedArea?.name]);
  useEffect(() => () => {
    if (anatomyScene) disposeAnatomyFigureScene(anatomyScene);
  }, [anatomyScene]);
  const groupRef = useRef<any>(null);
  const selectedSurfaceArea = useMemo(() => {
    if (!selectedArea || selectedArea.meshName === "brain") return selectedArea;
    const upperFaceShape = FACIAL_MUSCLE_SHAPES[selectedArea.name];
    const lowerFaceShapes = LOWER_FACIAL_MUSCLE_PATHS[selectedArea.name];
    const hipThighOverlay = HIP_THIGH_MUSCLE_PATHS[selectedArea.name];
    const lowerLegFootOverlay = LOWER_LEG_FOOT_MUSCLE_PATHS[selectedArea.name];
    const upperLimbOverlay = UPPER_LIMB_MUSCLE_PATHS[selectedArea.name];
    const laryngealOverlay = LARYNGEAL_MUSCLE_PATHS[selectedArea.name];
    const throatSwallowingOverlay = THROAT_SWALLOWING_MUSCLE_PATHS[selectedArea.name];
    const tongueMuscleOverlay = TONGUE_MUSCLE_PATHS[selectedArea.name];
    const skinSensationOverlay = SKIN_SENSATION_PATHS[selectedArea.name];
    if (upperFaceShape || lowerFaceShapes || hipThighOverlay || lowerLegFootOverlay || upperLimbOverlay || laryngealOverlay || throatSwallowingOverlay || tongueMuscleOverlay) {
      const anchoredUpperFacePaths = upperFaceShape?.surface
        ? getSurfaceAnchoredPaths(
          scene,
          selectedArea.name,
          upperFaceShape.paths,
          upperFaceShape.surface,
        )
        : null;
      const sourceRibbons: {
        points: ModelOffset[];
        halfWidth: number;
        closed?: boolean;
        surfaceNormal?: ModelOffset;
        surface?: MuscleSurface;
        surfaceDraped?: boolean;
      }[] = upperFaceShape
        ? upperFaceShape.paths.flatMap((sourcePoints, index) => {
            const points = anchoredUpperFacePaths?.[index] ?? sourcePoints;
            if (upperFaceShape.surface && (!points || points.length < 2)) return [];
            const normal = upperFaceShape.surface
              ? sourceSurfaceDirection(new Vector3(...sourcePoints[0]), upperFaceShape.surface)
              : null;
            return [{
              points,
              halfWidth: upperFaceShape.halfWidth,
              closed: upperFaceShape.kind === "ring",
              ...(normal ? { surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset } : {}),
            }];
          })
        : lowerFaceShapes
          ? lowerFaceShapes.flatMap(({ centerline, width, thickness, closed, surface }, index) => {
            const points = surface
              ? getSurfaceAnchoredPaths(
                scene,
                `${selectedArea.name}:${index}`,
                [centerline],
                surface,
              )[0]
              : centerline;
            if (surface && (!points || points.length < 2)) return [];
            const normal = surface
              ? sourceSurfaceDirection(new Vector3(...centerline[0]), surface)
              : null;
            return [{
              points,
              halfWidth: Math.max(width / 2, thickness),
              closed,
              ...(normal ? { surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset } : {}),
            }];
          })
          : lowerLegFootOverlay
            ? lowerLegFootOverlay.paths.flatMap(({ points, surface, halfWidth }, index) => {
              const surfacePoints = getSurfaceAnchoredPaths(
                scene,
                `${selectedArea.name}:${index}`,
                [points],
                surface,
              )[0];
              if (!surfacePoints || surfacePoints.length < 2) return [];
              const normal = sourceSurfaceDirection(new Vector3(...points[0]), surface);
              return [{
                points: surfacePoints,
                halfWidth: halfWidth ?? lowerLegFootOverlay.halfWidth,
                closed: false,
                surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset,
              }];
            })
          : upperLimbOverlay
            ? upperLimbOverlay.paths.flatMap(({ points, surface, halfWidth }, index) => {
              const surfacePoints = getSurfaceAnchoredPaths(
                scene,
                `${selectedArea.name}:${index}`,
                [points],
                surface,
              )[0];
              if (!surfacePoints || surfacePoints.length < 2) return [];
              const normal = sourceSurfaceDirection(new Vector3(...points[0]), surface);
              return [{
                points: surfacePoints,
                halfWidth: halfWidth ?? upperLimbOverlay.halfWidth,
                closed: false,
                surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset,
                surface,
                surfaceDraped: upperLimbOverlay.surfaceDraped,
              }];
            })
          : laryngealOverlay
            ? laryngealOverlay.paths.flatMap(({ points, surface, halfWidth }, index) => {
              const surfacePoints = getSurfaceAnchoredPaths(
                scene,
                `${selectedArea.name}:${index}`,
                [points],
                surface,
              )[0];
              if (!surfacePoints || surfacePoints.length < 2) return [];
              const normal = sourceSurfaceDirection(new Vector3(...points[0]), surface);
              return [{
                points: surfacePoints,
                halfWidth,
                closed: false,
                surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset,
                surface,
                surfaceDraped: laryngealOverlay.surfaceDraped,
              }];
            })
          : throatSwallowingOverlay
            ? throatSwallowingOverlay.paths.flatMap(({ points, surface, halfWidth }, index) => {
              const surfacePoints = getSurfaceAnchoredPaths(
                scene,
                `${selectedArea.name}:${index}`,
                [points],
                surface,
              )[0];
              if (!surfacePoints || surfacePoints.length < 2) return [];
              const normal = sourceSurfaceDirection(new Vector3(...points[0]), surface);
              return [{
                points: surfacePoints,
                halfWidth,
                closed: false,
                surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset,
                surface,
                surfaceDraped: throatSwallowingOverlay.surfaceDraped,
              }];
            })
          : tongueMuscleOverlay
            ? tongueMuscleOverlay.paths.map(({ points, halfWidth }) => ({
              points,
              halfWidth,
              closed: false,
            }))
            : (hipThighOverlay?.paths ?? []).flatMap((sourcePoints, index) => {
              const points = hipThighOverlay?.surfaceAnchored
                ? getSurfaceAnchoredPaths(
                  scene,
                  `${selectedArea.name}:${index}`,
                  [sourcePoints],
                  hipThighOverlay.surface,
                )[0]
                : sourcePoints;
              if (hipThighOverlay?.surfaceAnchored && (!points || points.length < 2)) return [];
              const normal = hipThighOverlay?.surfaceAnchored
                ? sourceSurfaceDirection(new Vector3(...sourcePoints[0]), hipThighOverlay.surface)
                : null;
              return [{
                points,
                halfWidth: hipThighOverlay?.halfWidth ?? 0.01,
                closed: false,
                ...(normal ? { surfaceNormal: [normal.x, normal.y, normal.z] as ModelOffset } : {}),
              }];
            });
      const sourcePatches = upperFaceShape?.outline ? [upperFaceShape.outline] : [];
      return {
        ...selectedArea,
        musclePatches: sourcePatches.map((points) => points.map((point) => modelPointToWorld(
          point,
          figureTransform.position,
          figureTransform.scale,
          modelOffset,
        ))),
        muscleRibbons: sourceRibbons.map(({ points, halfWidth, closed, surfaceNormal, surface, surfaceDraped }, index) => {
          const toWorldEdges = (edges: ReturnType<typeof getSurfaceAnchoredRibbonEdges>) => edges ? {
            left: edges.left.map((point) => modelPointToWorld(point, figureTransform.position, figureTransform.scale, modelOffset)),
            right: edges.right.map((point) => modelPointToWorld(point, figureTransform.position, figureTransform.scale, modelOffset)),
          } : undefined;
          const fillEdges = surfaceDraped && surface
            ? getSurfaceAnchoredRibbonEdges(scene, `${selectedArea.name}:${index}:fill`, points, surface, halfWidth)
            : null;
          const glowEdges = surfaceDraped && surface
            ? getSurfaceAnchoredRibbonEdges(scene, `${selectedArea.name}:${index}:glow`, points, surface, halfWidth * 1.55)
            : null;
          const surfaceEdges = toWorldEdges(fillEdges);
          const glowSurfaceEdges = toWorldEdges(glowEdges);
          return {
            points: points.map((point) => modelPointToWorld(
              point,
              figureTransform.position,
              figureTransform.scale,
              modelOffset,
            )),
            halfWidth: halfWidth * figureTransform.scale,
            closed,
            surfaceNormal,
            ...(surfaceEdges ? { surfaceEdges } : {}),
            ...(glowSurfaceEdges ? { glowSurfaceEdges } : {}),
          };
        }),
        surfaceAnchored: Boolean(
          lowerLegFootOverlay
          || hipThighOverlay?.surfaceAnchored
          || upperLimbOverlay
          || laryngealOverlay
          || throatSwallowingOverlay
          || upperFaceShape?.surface
          || lowerFaceShapes?.some(({ surface }) => Boolean(surface)),
        ),
      };
    }
    if (skinSensationOverlay) {
      const markerPaths = skinSensationOverlay.paths.flatMap(({ points, surface }, index) => {
        const surfacePoints = getSurfaceAnchoredPaths(
          scene,
          `${selectedArea.name}:${index}`,
          [points],
          surface,
        )[0];
        if (!surfacePoints || surfacePoints.length < 2) return [];
        return [surfacePoints.map((point) => modelPointToWorld(
          point,
          figureTransform.position,
          figureTransform.scale,
          modelOffset,
        ))];
      });
      return { ...selectedArea, markerPaths, surfaceAnchored: true };
    }
    const customPaths = ANATOMY_NERVE_PATHS[selectedArea.name];
    const anchorPathNames = NERVE_RIG_PATHS[selectedArea.name];
    if (customPaths) {
      const sourcePaths = selectedArea.name === "Common fibular nerve"
        ? getSurfaceAnchoredPaths(scene, selectedArea.name, customPaths)
        : customPaths;
      const markerPaths = sourcePaths.map((path) => path.map((point) =>
        modelPointToWorld(
          selectedArea.name === "Cranial nerve VII Facial"
            || selectedArea.name === "Common fibular nerve"
            || selectedArea.name === "Neuromuscular junction"
            ? point
            : insetNervePathPoint(point),
          figureTransform.position,
          figureTransform.scale,
          modelOffset,
        ),
      ));
      if (markerPaths.length) return { ...selectedArea, markerPaths };
    }
    if (anchorPathNames) {
      const markerPaths = anchorPathNames.map((path) => path.map((name) => {
        const anchorPoint = name === "brain" ? figureTransform.brainPosition : resolveModelAnchor(scene, name);
        if (!anchorPoint) return null;
        return modelPointToWorld(
          insetNervePathPoint(anchorPoint),
          figureTransform.position,
          figureTransform.scale,
          modelOffset,
        );
      }).filter((point): point is [number, number, number] => point !== null)).filter((path) => path.length > 1);
      if (markerPaths.length) return { ...selectedArea, markerPaths };
    }
    const sourceCenter = physiologySourceCenter(selectedArea.name, scene)
      ?? sourcePointFromWorld(selectedArea.position, figureTransform.position, figureTransform.scale, modelOffset);
    const regionCenter = modelPointToWorld(sourceCenter, figureTransform.position, figureTransform.scale, modelOffset);
    const baseRegionArea = physiologySourceCenter(selectedArea.name, scene)
      ? { ...selectedArea, position: regionCenter, target: regionCenter }
      : selectedArea;
    const cacheKey = [modelUrl, selectedArea.name, ...regionCenter, ...modelOffset].join(":");
    let anchor = surfaceAnchorCache.get(cacheKey);
    if (anchor === undefined) {
      anchor = findFigureSurfaceAnchor(scene, selectedArea.name, regionCenter, figureTransform.position, figureTransform.scale, modelOffset);
      if (surfaceAnchorCache.size >= 256) surfaceAnchorCache.clear();
      surfaceAnchorCache.set(cacheKey, anchor);
    }
    const regionPatches = selectedArea.name === "Eyes"
      ? createEyeSurfacePatches(scene, figureTransform.position, figureTransform.scale, modelOffset)
      : null;
    const isEarArea = selectedArea.name.startsWith("Ears (");
    const earContour = isEarArea && anchor
      ? createSurfaceEllipseContour(anchor.position, [0, 0, 1], 0.016, 0.035)
      : null;
    const regionPatch = regionPatches
      ? []
      : isEarArea
        ? earContour ?? []
        : createRegionSurfacePatch(
          scene,
          selectedArea.name,
          sourceCenter,
          figureTransform.position,
          figureTransform.scale,
          modelOffset,
        );
    const regionArea = regionPatches?.length
      ? { ...baseRegionArea, regionPatches }
      : { ...baseRegionArea, regionPatch };
    if (anchor) return { ...regionArea, markerPosition: anchor.position, surfaceNormal: anchor.normal };
    if (regionPatches?.length || regionPatch.length) return regionArea;
    return selectedArea;
  }, [figureTransform, modelOffset, modelUrl, scene, selectedArea, FACIAL_MUSCLE_SHAPES[selectedArea?.name ?? ""], LARYNGEAL_MUSCLE_PATHS[selectedArea?.name ?? ""], THROAT_SWALLOWING_MUSCLE_PATHS[selectedArea?.name ?? ""]]);

  const onPointerDown = useCallback(
    (e: any) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (isEditMode) {
        e.stopPropagation();
        if (groupRef.current) {
          const localPoint = groupRef.current.worldToLocal(e.point.clone());
          onAddHotspot(localPoint);
        }
        return;
      }
      if (!physiologyClickToFocus || !onAreaSelect) return;

      const sourcePoint = sourcePointFromWorld(
        [e.point.x, e.point.y, e.point.z],
        figureTransform.position,
        figureTransform.scale,
        modelOffset,
      );
      const pickedSourceArea = resolvePhysiologyAreaAtPoint(sourcePoint, physiologySourceAreas);
      const selectedArea = pickedSourceArea
        ? physiologyAreas.find((area) => area.name === pickedSourceArea.name) ?? null
        : null;
      if (selectedArea && pickedSourceArea) {
        e.stopPropagation();
        const regionCenter = modelPointToWorld(pickedSourceArea.position, figureTransform.position, figureTransform.scale, modelOffset);
        onAreaSelect({ ...selectedArea, position: regionCenter, target: regionCenter });
      }
    },
    [figureTransform, isEditMode, modelOffset, onAddHotspot, onAreaSelect, physiologyAreas, physiologyClickToFocus, physiologySourceAreas],
  );

  return (
    <group ref={groupRef} position={MODEL_ROOT_POSITION}>
      {/* useGLTF caches scenes by URL; Clone gives each canvas its own Object3D tree. */}
      <group position={figureTransform.position} scale={figureTransform.scale}>
        <Clone object={showAnatomyBrain && anatomyScene ? anatomyScene : scene} position={modelOffset} onPointerDown={onPointerDown} />
        {showAnatomyBrain && (
          <Brain
            centerAt={figureTransform.brainPosition}
            scale={brainFocused ? [0.33, 0.33, 0.33] : [0.28, 0.28, 0.28]}
            opacity={brainFocused ? 1 : 0.05}
          >
            {selectedArea?.meshName === "brain" && <BrainRegionHighlight area={selectedArea} />}
          </Brain>
        )}
      </group>
      {showSelectionHalo && selectedSurfaceArea && selectedSurfaceArea.meshName !== "brain" && <AreaMarker selectedArea={selectedSurfaceArea} />}
      {!showSelectionHalo && visibleAreas?.map((area) => <AreaMarker key={area.name} selectedArea={area} onSelect={onAreaSelect} />)}
      {children}
    </group>
  );
}

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
`;

const HintOverlay = styled.div`
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 10px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: none;
`;

export const Model3DPerson: React.FC<{
  onAreaSelect?: (area: Area) => void;
  modelUrl?: string;
  modelOffset?: [number, number, number];
  areas?: Area[];
  visibleAreaNames?: string[];
  activeAreaName?: string;
  showSelectionHalo?: boolean;
  anatomyView?: boolean;
  brainFocused?: boolean;
  physiologyClickToFocus?: boolean;
  showTransformControls?: boolean;
  scrollRotate?: boolean;
  initialCameraPosition?: [number, number, number];
  initialCameraTarget?: [number, number, number];
}> = ({
  onAreaSelect,
  modelUrl = HUMAN_MODEL_AFRO_MALE_GLB_URL,
  modelOffset = [0, 0, 0],
  areas = [],
  visibleAreaNames,
  showSelectionHalo = true,
  anatomyView = false,
  brainFocused = false,
  physiologyClickToFocus = false,
  showTransformControls = true,
  scrollRotate = false,
  initialCameraPosition = DEFAULT_MODEL_CAMERA_POSITION,
  initialCameraTarget = DEFAULT_MODEL_CAMERA_TARGET,
}) => {
  const { selectedArea, controlsRef } = useModel3D();
  const {
    hotspots,
    selectedHotspot,
    showGrid,
    sidebarTab,
    handleAddHotspot,
    handleHotspotClick,
    multiSelectedHotspots,
  } = useHotspotEditor();
  const isEditMode = sidebarTab === "make-hotspots";
  const visibleAreas = visibleAreaNames ? areas.filter((area) => visibleAreaNames.includes(area.name)) : [];
  const personModel = (
    <PersonModel
      selectedArea={selectedArea}
      isEditMode={isEditMode}
      onAddHotspot={handleAddHotspot}
      modelUrl={modelUrl}
      modelOffset={modelOffset}
      showSelectionHalo={showSelectionHalo}
      showAnatomyBrain={anatomyView}
      brainFocused={brainFocused}
      physiologyClickToFocus={physiologyClickToFocus}
      physiologyAreas={physiologyClickToFocus ? areas : []}
      visibleAreas={visibleAreas}
      onAreaSelect={onAreaSelect}
    >
      {isEditMode && <HorizonFocusGlobe active />}
      {hotspots.map((hotspot) => (
        <HotspotMarker
          key={hotspot.id}
          hotspot={hotspot}
          onClick={() => handleHotspotClick(hotspot.id)}
          isSelected={selectedHotspot === hotspot.id}
          isMultiSelected={multiSelectedHotspots.includes(hotspot.id)}
        />
      ))}
    </PersonModel>
  );

  return (
    <CanvasContainer>
      <Canvas
        style={{ width: "100%", height: "100%" }}
        camera={{ position: initialCameraPosition, fov: MODEL_FOV }}
        dpr={[1, 1.25]}
        frameloop="demand"
      >
        <RendererSizeSync />
        <Suspense fallback={null}>
          <ambientLight intensity={MODEL_AMBIENT_LIGHT_INTENSITY} />
          <directionalLight
            position={MODEL_KEY_LIGHT_POSITION}
            intensity={MODEL_KEY_LIGHT_INTENSITY}
          />
          <pointLight
            position={MODEL_FILL_LIGHT_POSITION}
            intensity={MODEL_FILL_LIGHT_INTENSITY}
            color="#ffffff"
          />
          <pointLight
            position={MODEL_BACK_LIGHT_POSITION}
            intensity={MODEL_BACK_LIGHT_INTENSITY}
            color="#8ddcff"
          />
          <pointLight
            position={[-2.8, 2.4, -4.2]}
            intensity={1.4}
            color="#7cc7ff"
          />
          <pointLight
            position={[2.8, 2.4, -4.2]}
            intensity={1.4}
            color="#7cc7ff"
          />
          <directionalLight
            position={[
              -MODEL_KEY_LIGHT_POSITION[0],
              MODEL_KEY_LIGHT_POSITION[1],
              -MODEL_KEY_LIGHT_POSITION[2],
            ]}
            intensity={MODEL_KEY_LIGHT_INTENSITY * 0.9}
            color="#ffffff"
          />
          <pointLight
            position={[
              -MODEL_FILL_LIGHT_POSITION[0],
              MODEL_FILL_LIGHT_POSITION[1],
              -MODEL_FILL_LIGHT_POSITION[2],
            ]}
            intensity={MODEL_FILL_LIGHT_INTENSITY * 1.0}
            color="#ffffff"
          />
          {isEditMode && showGrid && (
            <gridHelper args={[10, 10, "#333", "#222"]} position={[0, 0, 0]} />
          )}
          {showTransformControls && isEditMode ? (
            <TransformControls mode="translate">{personModel}</TransformControls>
          ) : personModel}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.12}
            rotateSpeed={0.9}
            zoomSpeed={1.15}
            target={initialCameraTarget}
          />
          <CameraFocusController
            brainFocused={brainFocused}
            initialCameraPosition={initialCameraPosition}
            initialCameraTarget={initialCameraTarget}
          />
          <ModelScrollRotation enabled={scrollRotate} />
        </Suspense>
      </Canvas>
      {isEditMode && (
        <HintOverlay>Click on the model to add hotspots</HintOverlay>
      )}
    </CanvasContainer>
  );
};

import React, { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';
import { PersonStanding, Rotate3D, ScanFace } from 'lucide-react';
import { gsap } from 'gsap';
import { Model3DPerson } from '@n-apt/three-d/Model3DPerson';
import { HUMAN_MODEL_NEUTRAL_GLB_URL } from '@n-apt/three-d/modelAssetUrls';
import { Model3DInteractionProvider } from '@n-apt/three-d/hooks/useHotspotEditor';
import { Model3DProvider, useModel3D, type Area } from '@n-apt/three-d/hooks/useModel3D';
import { findBodyMapArea, findBodyMapOptionForArea, addBodyMapSelection } from '../utils/questionnaireBodyMap';
import { NEUTRAL_BODY_MAP_AREAS } from '../data/neutralBodyMapAreas';

const BODY_MAP_INITIAL_AREA = NEUTRAL_BODY_MAP_AREAS.find(({ name }) => name === 'Head')!;
const CAMERA_VIEWS = [
  {
    label: 'Headshot',
    icon: ScanFace,
    position: BODY_MAP_INITIAL_AREA.position,
    target: BODY_MAP_INITIAL_AREA.target,
  },
  {
    label: 'Full view · top to bottom',
    icon: PersonStanding,
    position: [0, 1.02, 4] as [number, number, number],
    target: [0, 1.02, 0] as [number, number, number],
  },
  {
    label: 'Side view · front to back',
    icon: Rotate3D,
    position: [0, 1.02, -4] as [number, number, number],
    target: [0, 1.02, 0] as [number, number, number],
  },
];

const BodyMapLayout = styled.div`
  display: grid;
  gap: 16px;
`;

const ModelFrame = styled.div`
  position: relative;
  width: 100%;
  height: clamp(280px, 42vh, 460px);
  min-height: 280px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
`;

const CameraViewButton = styled.button`
  position: absolute;
  z-index: 1;
  right: 10px;
  bottom: 10px;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 1px solid #d1d5db;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #6b7280;
  cursor: pointer;

  &:hover { background: #f3f4f6; color: #374151; }
  &:focus-visible { outline: 2px solid #9ca3af; outline-offset: 2px; }
`;

const RegionOptions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const RegionOption = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #fff;
  color: #111827;
  cursor: pointer;

  input { accent-color: #2563eb; }
`;

type QuestionnaireBodyMapProps = {
  question: { id: string; options: string[] };
  answer: string[];
  onAnswerChange: (questionId: string, value: string[]) => void;
};

export function QuestionnaireBodyMap(props: QuestionnaireBodyMapProps) {
  return (
    <Model3DProvider>
      <Model3DInteractionProvider persist={false}>
        <QuestionnaireBodyMapContent {...props} />
      </Model3DInteractionProvider>
    </Model3DProvider>
  );
}

function QuestionnaireBodyMapContent({ question, answer, onAnswerChange }: QuestionnaireBodyMapProps) {
  const { selectedArea, setSelectedArea, controlsRef } = useModel3D();
  const [nextCameraViewIndex, setNextCameraViewIndex] = useState(1);
  const orbitTweenTarget = useRef<object | null>(null);
  const selectedOptions = Array.isArray(answer) ? answer : [];
  const NextViewIcon = CAMERA_VIEWS[nextCameraViewIndex].icon;

  const stopCameraPan = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    gsap.killTweensOf(controls.object.position);
    gsap.killTweensOf(controls.target);
    if (orbitTweenTarget.current) {
      gsap.killTweensOf(orbitTweenTarget.current);
      orbitTweenTarget.current = null;
    }
  }, [controlsRef]);

  const focusArea = useCallback((area: Area) => {
    stopCameraPan();
    setSelectedArea(area);
    const controls = controlsRef.current;
    if (!controls) return;

    controls.object.position.set(...area.position);
    controls.target.set(...area.target);
    controls.update();
  }, [controlsRef, setSelectedArea, stopCameraPan]);

  const cycleCameraView = useCallback(() => {
    stopCameraPan();
    const controls = controlsRef.current;
    const view = CAMERA_VIEWS[nextCameraViewIndex];
    setNextCameraViewIndex((nextCameraViewIndex + 1) % CAMERA_VIEWS.length);
    if (!controls) return;

    if (nextCameraViewIndex === 2) {
      const orbit = { progress: 0 };
      orbitTweenTarget.current = orbit;
      gsap.to(orbit, {
        progress: 1,
        duration: 6,
        ease: 'power2.inOut',
        onUpdate: () => {
          const angle = orbit.progress * Math.PI;
          controls.object.position.set(4 * Math.sin(angle), view.position[1], 4 * Math.cos(angle));
          controls.target.set(...view.target);
          controls.update();
        },
        onComplete: () => {
          if (orbitTweenTarget.current === orbit) orbitTweenTarget.current = null;
        },
      });
      return;
    }

    const tweenOptions = {
      duration: 6,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
    };
    gsap.to(controls.object.position, {
      ...tweenOptions,
      x: view.position[0],
      y: view.position[1],
      z: view.position[2],
    });
    gsap.to(controls.target, {
      ...tweenOptions,
      x: view.target[0],
      y: view.target[1],
      z: view.target[2],
    });
  }, [controlsRef, nextCameraViewIndex, stopCameraPan]);

  const handleRegionClick = useCallback((area: Area) => {
    const option = findBodyMapOptionForArea(area.name, question.options);
    if (!option) return;
    onAnswerChange(question.id, addBodyMapSelection(selectedOptions, option));
    focusArea(area);
  }, [focusArea, onAnswerChange, question.id, question.options, selectedOptions]);

  const handleOptionChange = (option: string) => {
    const nextOptions = selectedOptions.includes(option)
      ? selectedOptions.filter((selected) => selected !== option)
      : [...selectedOptions, option];
    onAnswerChange(question.id, nextOptions);

    const area = findBodyMapArea(option, NEUTRAL_BODY_MAP_AREAS);
    if (area && !selectedOptions.includes(option)) {
      setNextCameraViewIndex(1);
      focusArea(area);
    } else {
      stopCameraPan();
    }
  };

  return (
    <BodyMapLayout>
      <ModelFrame aria-label="Interactive body map">
        <CameraViewButton
          type="button"
          aria-label={`Cycle model view; next: ${CAMERA_VIEWS[nextCameraViewIndex].label}`}
          title={`Next view: ${CAMERA_VIEWS[nextCameraViewIndex].label}`}
          onClick={cycleCameraView}
        >
          <NextViewIcon size={16} strokeWidth={1.75} aria-hidden="true" data-testid={`body-map-view-icon-${nextCameraViewIndex}`} />
        </CameraViewButton>
        <Model3DPerson
          onAreaSelect={handleRegionClick}
          modelUrl={HUMAN_MODEL_NEUTRAL_GLB_URL}
          modelOffset={[0, -0.95, 0]}
          areas={NEUTRAL_BODY_MAP_AREAS}
          visibleAreaNames={selectedOptions}
          activeAreaName={selectedArea?.name ?? BODY_MAP_INITIAL_AREA.name}
          showSelectionHalo={false}
          showTransformControls={false}
          scrollRotate
          initialCameraPosition={BODY_MAP_INITIAL_AREA.position}
          initialCameraTarget={BODY_MAP_INITIAL_AREA.target}
        />
      </ModelFrame>
      <RegionOptions role="group" aria-label="Select affected body areas">
        {question.options.map((option) => (
          <RegionOption key={option}>
            <input
              type="checkbox"
              checked={selectedOptions.includes(option)}
              onChange={() => handleOptionChange(option)}
            />
            {option}
          </RegionOption>
        ))}
      </RegionOptions>
    </BodyMapLayout>
  );
}

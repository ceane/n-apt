import React, { useCallback } from 'react';
import styled from 'styled-components';
import { ScanFace } from 'lucide-react';
import { gsap } from 'gsap';
import { Model3DPerson } from '@n-apt/three-d/Model3DPerson';
import { HUMAN_MODEL_NEUTRAL_GLB_URL } from '@n-apt/three-d/modelAssetUrls';
import { Model3DInteractionProvider } from '@n-apt/three-d/hooks/useHotspotEditor';
import { Model3DProvider, useModel3D, type Area } from '@n-apt/three-d/hooks/useModel3D';
import { NEUTRAL_HEAD_MAP_AREAS } from '../data/neutralHeadMapAreas';

const HEAD_CAMERA_POSITION: [number, number, number] = [0, 1.95, 0.42];
const HEAD_CAMERA_TARGET: [number, number, number] = [0, 1.92, 0.02];

const HeadMapLayout = styled.div`
  display: grid;
  gap: 16px;
`;

const ModelFrame = styled.div`
  position: relative;
  width: 100%;
  height: clamp(240px, 34vh, 360px);
  min-height: 240px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
`;

const HeadshotButton = styled.button`
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
  background: rgba(255, 255, 255, 0.92);
  color: #6b7280;
  cursor: pointer;

  &:hover { background: #f3f4f6; color: #374151; }
  &:focus-visible { outline: 2px solid #9ca3af; outline-offset: 2px; }
`;

const AffectedOptions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const AffectedOption = styled.label`
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

type QuestionnaireHeadMapProps = {
  question: { id: string; options: string[] };
  answer: string[];
  onAnswerChange: (questionId: string, value: string[]) => void;
};

export function QuestionnaireHeadMap({ question, answer, onAnswerChange }: QuestionnaireHeadMapProps) {
  return (
    <Model3DProvider>
      <Model3DInteractionProvider persist={false}>
        <QuestionnaireHeadMapContent question={question} answer={answer} onAnswerChange={onAnswerChange} />
      </Model3DInteractionProvider>
    </Model3DProvider>
  );
}

function QuestionnaireHeadMapContent({ question, answer, onAnswerChange }: QuestionnaireHeadMapProps) {
  const { selectedArea, setSelectedArea, controlsRef } = useModel3D();
  const selectedOptions = Array.isArray(answer) ? answer : [];

  const stopCameraMotion = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    gsap.killTweensOf(controls.object.position);
    gsap.killTweensOf(controls.target);
  }, [controlsRef]);

  const animateCameraTo = useCallback((position: [number, number, number], target: [number, number, number]) => {
    const controls = controlsRef.current;
    if (!controls) return;
    stopCameraMotion();
    const tweenOptions = {
      duration: 1.2,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
    };
    gsap.to(controls.object.position, { ...tweenOptions, x: position[0], y: position[1], z: position[2] });
    gsap.to(controls.target, { ...tweenOptions, x: target[0], y: target[1], z: target[2] });
  }, [controlsRef, stopCameraMotion]);

  const focusArea = useCallback((area: Area) => {
    setSelectedArea(area);
    animateCameraTo(area.position, area.target);
  }, [animateCameraTo, setSelectedArea]);

  const returnToHeadshot = () => animateCameraTo(HEAD_CAMERA_POSITION, HEAD_CAMERA_TARGET);

  const selectArea = useCallback((area: Area) => {
    if (!question.options.includes(area.name)) return;
    const nextOptions = selectedOptions.includes(area.name)
      ? selectedOptions
      : [...selectedOptions, area.name];
    onAnswerChange(question.id, nextOptions);
    focusArea(area);
  }, [focusArea, onAnswerChange, question.id, question.options, selectedOptions]);

  const toggleOption = (option: string) => {
    const area = NEUTRAL_HEAD_MAP_AREAS.find(({ name }) => name === option);
    if (!selectedOptions.includes(option)) {
      if (area) selectArea(area);
      else onAnswerChange(question.id, [...selectedOptions, option]);
      return;
    }
    onAnswerChange(question.id, selectedOptions.filter((selected) => selected !== option));
  };

  return (
    <HeadMapLayout>
      <ModelFrame aria-label="Close-up of the head on the neutral body model">
        <HeadshotButton type="button" aria-label="Return model to headshot" title="Return to headshot" onClick={returnToHeadshot}>
          <ScanFace size={16} strokeWidth={1.75} aria-hidden="true" />
        </HeadshotButton>
        <Model3DPerson
          modelUrl={HUMAN_MODEL_NEUTRAL_GLB_URL}
          modelOffset={[0, -0.95, 0]}
          onAreaSelect={selectArea}
          areas={NEUTRAL_HEAD_MAP_AREAS.filter(({ name }) => question.options.includes(name))}
          visibleAreaNames={selectedOptions}
          activeAreaName={selectedArea?.name}
          showSelectionHalo={false}
          showTransformControls={false}
          initialCameraPosition={HEAD_CAMERA_POSITION}
          initialCameraTarget={HEAD_CAMERA_TARGET}
        />
      </ModelFrame>
      <AffectedOptions role="group" aria-label="Select affected head areas">
        {question.options.map((option) => (
          <AffectedOption key={option}>
            <input
              type="checkbox"
              checked={selectedOptions.includes(option)}
              onChange={() => toggleOption(option)}
            />
            {option}
          </AffectedOption>
        ))}
      </AffectedOptions>
    </HeadMapLayout>
  );
}

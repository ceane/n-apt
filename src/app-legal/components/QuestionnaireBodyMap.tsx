import React, { useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { gsap } from 'gsap';
import { PHYSIOLOGY_AREAS } from '@n-apt/learn';
import { Model3DPerson } from '@n-apt/three-d/Model3DPerson';
import { Model3DInteractionProvider } from '@n-apt/three-d/hooks/useHotspotEditor';
import { Model3DProvider, useModel3D, type Area } from '@n-apt/three-d/hooks/useModel3D';
import { findBodyMapArea, findBodyMapOptionForArea, addBodyMapSelection } from '../utils/questionnaireBodyMap';

const BodyMapLayout = styled.div`
  display: grid;
  gap: 16px;
`;

const ModelFrame = styled.div`
  width: 100%;
  height: clamp(280px, 42vh, 460px);
  min-height: 280px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
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
  const selectedOptions = Array.isArray(answer) ? answer : [];

  const focusArea = useCallback((area: Area) => {
    setSelectedArea(area);
    const controls = controlsRef.current;
    if (!controls) return;

    gsap.to(controls.object.position, {
      x: area.position[0],
      y: area.position[1],
      z: area.position[2],
      duration: 0.8,
      ease: 'power2.inOut',
    });
    gsap.to(controls.target, {
      x: area.target[0],
      y: area.target[1],
      z: area.target[2],
      duration: 0.8,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
    });
  }, [controlsRef, setSelectedArea]);

  useEffect(() => {
    if (!selectedArea && selectedOptions.length > 0) {
      const area = findBodyMapArea(selectedOptions[selectedOptions.length - 1] ?? '', PHYSIOLOGY_AREAS);
      if (area) focusArea(area);
    }
  }, [focusArea, selectedArea, selectedOptions]);

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

    const area = findBodyMapArea(option, PHYSIOLOGY_AREAS);
    if (area) focusArea(area);
  };

  return (
    <BodyMapLayout>
      <ModelFrame aria-label="Interactive body map">
        <Model3DPerson onAreaSelect={handleRegionClick} />
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

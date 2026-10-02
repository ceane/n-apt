import styled from 'styled-components';
import { HeadEffectsScene } from './HeadEffectsScene';

const EffectsLayout = styled.div`
  display: grid;
  gap: 16px;
`;

const ModelFrame = styled.div`
  width: 100%;
  height: clamp(260px, 36vh, 380px);
  min-height: 260px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
  canvas { width: 100% !important; height: 100% !important; display: block; }
`;

const EffectOptions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const EffectOption = styled.label`
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

type QuestionnaireHeadEffectsProps = {
  question: { id: string; options: string[] };
  answer: string[];
  onAnswerChange: (questionId: string, value: string[]) => void;
};

export function QuestionnaireHeadEffects({ question, answer, onAnswerChange }: QuestionnaireHeadEffectsProps) {
  const selectedEffects = Array.isArray(answer) ? answer : [];
  const selectedEffect = selectedEffects[selectedEffects.length - 1];
  const toggleEffect = (effect: string) => {
    const nextAnswer = selectedEffects.includes(effect)
      ? selectedEffects.filter((selected) => selected !== effect)
      : [...selectedEffects, effect];
    onAnswerChange(question.id, nextAnswer);
  };

  return (
    <EffectsLayout>
      <ModelFrame aria-label="Headshot with a translucent model and visible brain">
        <HeadEffectsScene selectedEffect={selectedEffect} />
      </ModelFrame>
      <EffectOptions role="group" aria-label="Select experienced effects or feelings">
        {question.options.map((effect) => (
          <EffectOption key={effect}>
            <input
              type="checkbox"
              checked={selectedEffects.includes(effect)}
              onChange={() => toggleEffect(effect)}
            />
            {effect}
          </EffectOption>
        ))}
      </EffectOptions>
    </EffectsLayout>
  );
}

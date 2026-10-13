import { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';
import { Blend, ScanFace } from 'lucide-react';
import { HEAD_EFFECT_APPEARANCE_STYLES } from '../data/headEffectBlobs';
import { HeadEffectsScene } from './HeadEffectsScene';

const EffectsLayout = styled.div`
  display: grid;
  gap: 16px;
`;

const ModelFrame = styled.div`
  position: relative;
  width: 100%;
  height: clamp(260px, 36vh, 380px);
  min-height: 260px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
  canvas { width: 100% !important; height: 100% !important; display: block; }
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

const AppearanceButton = styled(HeadshotButton)`
  bottom: 52px;
`;

const GhostPreviewOptions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const GhostPreviewButton = styled.button`
  padding: 7px 12px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #fff;
  color: #4b5563;
  font: inherit;
  cursor: pointer;

  &[aria-pressed='true'] {
    border-color: #2563eb;
    background: #eff6ff;
    color: #1d4ed8;
  }

  &:focus-visible { outline: 2px solid #9ca3af; outline-offset: 2px; }
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
  const resetCameraRef = useRef<(() => void) | null>(null);
  const [appearanceStyleIndex, setAppearanceStyleIndex] = useState(0);
  const handleResetReady = useCallback((reset: (() => void) | null) => {
    resetCameraRef.current = reset;
  }, []);
  const appearanceStyle = HEAD_EFFECT_APPEARANCE_STYLES[appearanceStyleIndex];
  const nextAppearanceStyle = HEAD_EFFECT_APPEARANCE_STYLES[(appearanceStyleIndex + 1) % HEAD_EFFECT_APPEARANCE_STYLES.length];
  const cycleAppearanceStyle = () => {
    setAppearanceStyleIndex((current) => (current + 1) % HEAD_EFFECT_APPEARANCE_STYLES.length);
  };
  const selectAppearanceStyle = (style: 'Evil ghost' | 'Peeking ghost') => {
    const index = HEAD_EFFECT_APPEARANCE_STYLES.indexOf(style);
    if (index >= 0) setAppearanceStyleIndex(index);
  };
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
        <HeadEffectsScene
          selectedEffect={selectedEffect}
          appearanceStyle={appearanceStyle}
          onResetReady={handleResetReady}
        />
        <AppearanceButton
          type="button"
          aria-label={`Cycle effect appearance: ${appearanceStyle}`}
          title={`Next: ${nextAppearanceStyle}`}
          onClick={cycleAppearanceStyle}
        >
          <Blend size={16} strokeWidth={1.75} aria-hidden="true" />
        </AppearanceButton>
        <HeadshotButton type="button" aria-label="Return model to headshot" title="Return to headshot" onClick={() => resetCameraRef.current?.()}>
          <ScanFace size={16} strokeWidth={1.75} aria-hidden="true" />
        </HeadshotButton>
      </ModelFrame>
      <GhostPreviewOptions role="group" aria-label="Preview ghost models">
        <GhostPreviewButton
          type="button"
          aria-pressed={appearanceStyle === 'Evil ghost'}
          onClick={() => selectAppearanceStyle('Evil ghost')}
        >
          Evil ghost
        </GhostPreviewButton>
        <GhostPreviewButton
          type="button"
          aria-pressed={appearanceStyle === 'Peeking ghost'}
          onClick={() => selectAppearanceStyle('Peeking ghost')}
        >
          Peeking ghost
        </GhostPreviewButton>
      </GhostPreviewOptions>
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

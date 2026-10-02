import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  HEAD_EFFECT_BLOB_DEFINITIONS,
  HEAD_EFFECT_BRAIN_POSITION,
  HEAD_EFFECT_BRAIN_OPACITY,
  HEAD_EFFECT_BRAIN_SCALE,
  HEAD_EFFECT_INACTIVE_COLOR,
  organicBlobRadius,
} from '../../src/app-legal/data/headEffectBlobs';

jest.mock('../../src/app-legal/components/HeadEffectsScene', () => ({
  HeadEffectsScene: ({ selectedEffect }: { selectedEffect?: string }) => (
    <div data-testid="head-effects-scene" data-selected-effect={selectedEffect ?? ''} />
  ),
}));

const { QuestionnaireHeadEffects } = require('../../src/app-legal/components/QuestionnaireHeadEffects') as typeof import('../../src/app-legal/components/QuestionnaireHeadEffects');

describe('QuestionnaireHeadEffects', () => {
  const options = [
    'Perceptual',
    'Compressed',
    'Chemical',
    'Somatic (sensations, pressure, jolts)',
    'Autonomic (manipulating involuntary functions of your body)',
  ];

  test('uses a brain scale large enough to fill the skull', () => {
    expect(HEAD_EFFECT_BRAIN_SCALE).toBe(0.4365);
    const center = [
      HEAD_EFFECT_BRAIN_POSITION[0] - 0.3198 * HEAD_EFFECT_BRAIN_SCALE,
      0.95 + HEAD_EFFECT_BRAIN_POSITION[1] + 1.735 * HEAD_EFFECT_BRAIN_SCALE,
      HEAD_EFFECT_BRAIN_POSITION[2] - 0.5307 * HEAD_EFFECT_BRAIN_SCALE,
    ];
    expect(center[0]).toBeCloseTo(0);
    expect(center[1]).toBeCloseTo(1.95);
    expect(center[2]).toBeCloseTo(-0.005);
  });

  test('creates smooth, uneven blob outlines that change over time', () => {
    const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    const initialRadii = angles.map((angle) => organicBlobRadius(angle, 2, 0));
    const laterRadii = angles.map((angle) => organicBlobRadius(angle, 2, 1));

    expect(Math.max(...initialRadii) - Math.min(...initialRadii)).toBeGreaterThan(0.1);
    expect(laterRadii).not.toEqual(initialRadii);
    expect(Math.min(...initialRadii, ...laterRadii)).toBeGreaterThan(0.5);
  });

  test('keeps the effect blobs inside the translucent brain and uses grey for inactive blobs', () => {
    expect(HEAD_EFFECT_BRAIN_OPACITY).toBe(0.55);
    expect(HEAD_EFFECT_INACTIVE_COLOR).toBe('#9ca3af');
    for (const { position } of HEAD_EFFECT_BLOB_DEFINITIONS) {
      expect(position[0]).toBeGreaterThan(-0.083);
      expect(position[0]).toBeLessThan(0.084);
      expect(position[1] + 0.95).toBeGreaterThan(1.86);
      expect(position[1] + 0.95).toBeLessThan(2.04);
      expect(position[2]).toBeGreaterThan(-0.108);
      expect(position[2]).toBeLessThan(0.098);
    }
  });

  test('keeps multiple checkbox answers but shows only the latest selected blob', () => {
    const onAnswerChange = jest.fn();
    const view = render(
      <QuestionnaireHeadEffects
        question={{ id: '29h', options }}
        answer={['Perceptual', 'Chemical']}
        onAnswerChange={onAnswerChange}
      />,
    );

    expect(HEAD_EFFECT_BLOB_DEFINITIONS.map(({ name }) => name)).toEqual(options);
    expect(new Set(HEAD_EFFECT_BLOB_DEFINITIONS.map(({ position }) => position.join(','))).size).toBe(1);
    expect(screen.getByRole('checkbox', { name: 'Perceptual' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chemical' })).toBeChecked();
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-selected-effect', 'Chemical');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Somatic (sensations, pressure, jolts)' }));
    expect(onAnswerChange).toHaveBeenLastCalledWith('29h', ['Perceptual', 'Chemical', 'Somatic (sensations, pressure, jolts)']);
    view.rerender(
      <QuestionnaireHeadEffects
        question={{ id: '29h', options }}
        answer={['Perceptual', 'Chemical', 'Somatic (sensations, pressure, jolts)']}
        onAnswerChange={onAnswerChange}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Somatic (sensations, pressure, jolts)' })).toBeChecked();
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-selected-effect', 'Somatic (sensations, pressure, jolts)');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chemical' }));
    expect(onAnswerChange).toHaveBeenLastCalledWith('29h', ['Perceptual', 'Somatic (sensations, pressure, jolts)']);
    view.rerender(
      <QuestionnaireHeadEffects
        question={{ id: '29h', options }}
        answer={['Perceptual', 'Somatic (sensations, pressure, jolts)']}
        onAnswerChange={onAnswerChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Somatic (sensations, pressure, jolts)' }));
    expect(onAnswerChange).toHaveBeenLastCalledWith('29h', ['Perceptual']);
    view.rerender(
      <QuestionnaireHeadEffects
        question={{ id: '29h', options }}
        answer={['Perceptual']}
        onAnswerChange={onAnswerChange}
      />,
    );
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-selected-effect', 'Perceptual');
  });
});

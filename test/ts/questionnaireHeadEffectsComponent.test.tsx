import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  HEAD_EFFECT_BLOB_DEFINITIONS,
  HEAD_EFFECT_BRAIN_POSITION,
  HEAD_EFFECT_BRAIN_OPACITY,
  HEAD_EFFECT_BRAIN_SCALE,
  HEAD_EFFECT_FUR_CORE_RADIUS,
  HEAD_EFFECT_FUR_LENGTH,
  HEAD_EFFECT_INACTIVE_COLOR,
  organicBlobRadius,
  scraggleEmissionPoint,
  scraggleStrokePoint,
} from '../../src/app-legal/data/headEffectBlobs';

const mockResetCamera = jest.fn();

jest.mock('../../src/app-legal/components/HeadEffectsScene', () => ({
  HeadEffectsScene: ({ selectedEffect, appearanceStyle, onResetReady }: { selectedEffect?: string; appearanceStyle?: string; onResetReady?: (reset: () => void) => void }) => {
    onResetReady?.(() => mockResetCamera());
    return <div data-testid="head-effects-scene" data-selected-effect={selectedEffect ?? ''} data-appearance-style={appearanceStyle ?? ''} />;
  },
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
    expect(HEAD_EFFECT_BRAIN_OPACITY).toBe(0.72);
    expect(HEAD_EFFECT_INACTIVE_COLOR).toBe('#9ca3af');
    for (const { position } of HEAD_EFFECT_BLOB_DEFINITIONS) {
      expect(position[0]).toBeGreaterThan(-0.083);
      expect(position[0]).toBeLessThan(0.084);
      expect(position[1] + 0.95).toBeGreaterThan(1.86);
      expect(position[1] + 0.95).toBeLessThan(2.04);
      expect(position[2]).toBeGreaterThan(-0.108);
      expect(position[2]).toBeLessThan(0.098);
    }
    expect(HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeCloseTo(0.052);
  });

  test('keeps the furry dot smaller than the full blob as it turns', () => {
    expect(HEAD_EFFECT_FUR_CORE_RADIUS + HEAD_EFFECT_FUR_LENGTH).toBeLessThan(HEAD_EFFECT_BLOB_DEFINITIONS[0].radius);
  });

  test('provides a discreet control to return the camera to its headshot framing', () => {
    mockResetCamera.mockClear();
    render(
      <QuestionnaireHeadEffects
        question={{ id: '29h', options }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Return model to headshot' }));
    expect(mockResetCamera).toHaveBeenCalledTimes(1);
  });

  test('keeps the scraggle strokes within the brain-sized effect area', () => {
    for (let index = 0; index <= 200; index += 1) {
      const [x, y, z] = scraggleStrokePoint(index / 200);
      expect(Math.abs(x) * HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeLessThan(0.044);
      expect(Math.abs(y) * HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeLessThan(0.044);
      expect(Math.abs(z) * HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeLessThan(0.02);
    }
    for (let stroke = 0; stroke < 9; stroke += 1) {
      for (let index = 0; index <= 20; index += 1) {
        const [x, y, z] = scraggleEmissionPoint(stroke, index / 20);
        expect(Math.abs(x) * HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeLessThan(0.044);
        expect(Math.abs(y) * HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeLessThan(0.044);
        expect(Math.abs(z) * HEAD_EFFECT_BLOB_DEFINITIONS[0].radius).toBeLessThan(0.02);
      }
    }
  });

  test('cycles the blob appearance presets above the camera reset control', () => {
    render(
      <QuestionnaireHeadEffects
        question={{ id: '29h', options }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );

    const cycleButton = screen.getByRole('button', { name: 'Cycle effect appearance: Fur dot' });
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Fur dot');
    expect(cycleButton).toHaveAttribute('title', 'Next: Vortex clouds');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Vortex clouds');
    expect(cycleButton).toHaveAttribute('title', 'Next: Scraggles');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Scraggles');
    expect(cycleButton).toHaveAttribute('title', 'Next: C-clamp');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'C-clamp');
    expect(cycleButton).toHaveAttribute('title', 'Next: Water pipe');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Water pipe');
    expect(cycleButton).toHaveAttribute('title', 'Next: Rusty pistons');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Rusty pistons');
    expect(cycleButton).toHaveAttribute('title', 'Next: Evil ghost');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Evil ghost');
    expect(cycleButton).toHaveAttribute('title', 'Next: Peeking ghost');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Peeking ghost');
    expect(cycleButton).toHaveAttribute('title', 'Next: Fur dot');
    fireEvent.click(cycleButton);
    expect(screen.getByTestId('head-effects-scene')).toHaveAttribute('data-appearance-style', 'Fur dot');
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

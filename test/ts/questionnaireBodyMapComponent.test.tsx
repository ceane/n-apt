import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@n-apt/learn', () => ({
  PHYSIOLOGY_AREAS: [
    { name: 'Head', position: [0, 1, 0], target: [0, 1, 0], meshName: 'head' },
    { name: 'Throat', position: [0, 0.5, 0], target: [0, 0.5, 0], meshName: 'throat' },
  ],
}));
jest.mock('@n-apt/three-d/hooks/useModel3D', () => ({
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
  mockSetSelectedArea: jest.fn(),
  useModel3D: () => ({ selectedArea: null, setSelectedArea: jest.requireMock('@n-apt/three-d/hooks/useModel3D').mockSetSelectedArea, controlsRef: { current: null } }),
}));
jest.mock('@n-apt/three-d/hooks/useHotspotEditor', () => ({
  Model3DInteractionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@n-apt/three-d/Model3DPerson', () => ({
  Model3DPerson: ({ onAreaSelect }: { onAreaSelect: (area: { name: string; position: number[]; target: number[]; meshName: string }) => void }) => (
    <button type="button" onClick={() => onAreaSelect({ name: 'Head', position: [0, 1, 0], target: [0, 1, 0], meshName: 'head' })}>Select Head on model</button>
  ),
}));
jest.mock('gsap', () => ({ gsap: { to: jest.fn() } }));

const { QuestionnaireBodyMap } = require('../../src/app-legal/components/QuestionnaireBodyMap') as typeof import('../../src/app-legal/components/QuestionnaireBodyMap');
const { mockSetSelectedArea } = jest.requireMock('@n-apt/three-d/hooks/useModel3D') as { mockSetSelectedArea: jest.Mock };
const mockAreas = jest.requireMock('@n-apt/learn').PHYSIOLOGY_AREAS;

describe('QuestionnaireBodyMap', () => {
  beforeEach(() => mockSetSelectedArea.mockClear());

  test('selecting a spot on the model checks its matching option', () => {
    const onAnswerChange = jest.fn();
    render(
      <QuestionnaireBodyMap
        question={{ id: 'where-were-you-affected', options: ['Head', 'Neck'] }}
        answer={[]}
        onAnswerChange={onAnswerChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Head on model' }));

    expect(onAnswerChange).toHaveBeenCalledWith('where-were-you-affected', ['Head']);
  });

  test('selecting a checklist option focuses its matching model area', () => {
    const onAnswerChange = jest.fn();
    render(
      <QuestionnaireBodyMap
        question={{ id: 'where-were-you-affected', options: ['Head', 'Neck'] }}
        answer={[]}
        onAnswerChange={onAnswerChange}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Neck' }));

    expect(onAnswerChange).toHaveBeenCalledWith('where-were-you-affected', ['Neck']);
    expect(mockSetSelectedArea).toHaveBeenCalledWith(mockAreas[1]);
  });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Area } from '../../src/ts/features/three-d/hooks/useModel3D';

const mockControls = {
  object: { position: { x: 0, y: 0, z: 0, set: jest.fn() } },
  target: { x: 0, y: 0, z: 0, set: jest.fn() },
  update: jest.fn(),
};
const mockControlsRef = { current: mockControls };
jest.mock('@n-apt/three-d/hooks/useModel3D', () => ({
  Model3DProvider: ({ children }: { children: React.ReactNode }) => children,
  mockSetSelectedArea: jest.fn(),
  useModel3D: () => ({ selectedArea: null, setSelectedArea: jest.requireMock('@n-apt/three-d/hooks/useModel3D').mockSetSelectedArea, controlsRef: mockControlsRef }),
}));
jest.mock('@n-apt/three-d/hooks/useHotspotEditor', () => ({
  Model3DInteractionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@n-apt/three-d/modelAssetUrls', () => ({
  HUMAN_MODEL_NEUTRAL_GLB_URL: '/glb_models/human_model_neutral.glb',
}));
jest.mock('@n-apt/three-d/Model3DPerson', () => ({
  Model3DPerson: ({ onAreaSelect, modelUrl, modelOffset, initialCameraPosition, initialCameraTarget, areas, showTransformControls }: { onAreaSelect: (area: Area) => void; modelUrl?: string; modelOffset?: number[]; initialCameraPosition?: number[]; initialCameraTarget?: number[]; areas?: Area[]; showTransformControls?: boolean }) => (
    <div data-testid="body-map-3d-model" data-model-url={modelUrl} data-model-offset={JSON.stringify(modelOffset)} data-camera-position={JSON.stringify(initialCameraPosition)} data-camera-target={JSON.stringify(initialCameraTarget)} data-body-map-areas={JSON.stringify(areas)} data-transform-controls={String(showTransformControls)}>
      {areas?.flatMap((area) => (area.markerPositions ?? [area.markerPosition ?? area.target]).map((_, index) => (
        <button key={`${area.name}-${index}`} type="button" onClick={() => onAreaSelect(area)}>
          Select {area.name} marker {index + 1}
        </button>
      )))}
    </div>
  ),
}));
jest.mock('gsap', () => ({ gsap: { to: jest.fn(), killTweensOf: jest.fn() } }));

const { QuestionnaireBodyMap } = require('../../src/app-legal/components/QuestionnaireBodyMap') as typeof import('../../src/app-legal/components/QuestionnaireBodyMap');
const { mockSetSelectedArea } = jest.requireMock('@n-apt/three-d/hooks/useModel3D') as { mockSetSelectedArea: jest.Mock };
const { NEUTRAL_BODY_MAP_AREAS } = require('../../src/app-legal/data/neutralBodyMapAreas') as typeof import('../../src/app-legal/data/neutralBodyMapAreas');

describe('QuestionnaireBodyMap', () => {
  beforeEach(() => {
    mockSetSelectedArea.mockClear();
    mockControls.update.mockClear();
    jest.requireMock('gsap').gsap.to.mockClear();
    jest.requireMock('gsap').gsap.killTweensOf.mockClear();
  });

  test('cycles camera views and hides the transform gizmo', () => {
    render(
      <QuestionnaireBodyMap
        question={{ id: 'where-were-you-affected', options: ['Head', 'Neck'] }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );

    const cycleButton = screen.getByRole('button', { name: /cycle model view/i });
    expect(screen.getByTestId('body-map-3d-model')).toHaveAttribute('data-transform-controls', 'false');
    expect(screen.getByTestId('body-map-view-icon-1')).toBeInTheDocument();

    fireEvent.click(cycleButton);

    expect(jest.requireMock('gsap').gsap.to).toHaveBeenCalledTimes(2);
    const frontView = [0, 1.02, 4];
    expect(jest.requireMock('gsap').gsap.to).toHaveBeenCalledWith(
      mockControls.object.position,
      expect.objectContaining({ x: frontView[0], y: frontView[1], z: frontView[2], duration: 6 }),
    );
    expect(screen.getByTestId('body-map-view-icon-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cycle model view.*side view.*front to back/i })).toBeInTheDocument();

    fireEvent.click(cycleButton);
    const gsap = jest.requireMock('gsap').gsap;
    const orbit = gsap.to.mock.calls[2][0] as { progress: number };
    const orbitOptions = gsap.to.mock.calls[2][1] as { onUpdate: () => void };
    expect(orbitOptions).toEqual(expect.objectContaining({ duration: 6 }));
    orbit.progress = 0.5;
    orbitOptions.onUpdate();

    const positionCalls = mockControls.object.position.set.mock.calls;
    const sideViewPosition = positionCalls[positionCalls.length - 1];
    expect(sideViewPosition?.[0]).toBeCloseTo(4);
    expect(sideViewPosition?.[1]).toBe(1.02);
    expect(sideViewPosition?.[2]).toBeCloseTo(0);
    expect(screen.getByRole('button', { name: /cycle model view.*headshot/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Neck' }));
    expect(gsap.killTweensOf).toHaveBeenCalledWith(orbit);
    expect(mockControls.object.position.set).toHaveBeenLastCalledWith(...NEUTRAL_BODY_MAP_AREAS.find((area) => area.name === 'Neck')!.position);
  });

  test('uses the neutral, androgynous model aligned to the body map', () => {
    render(
      <QuestionnaireBodyMap
        question={{ id: 'where-were-you-affected', options: ['Head', 'Neck'] }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );

    const model = screen.getByTestId('body-map-3d-model');
    expect(model).toHaveAttribute('data-model-url', expect.stringContaining('human_model_neutral.glb'));
    expect(model).toHaveAttribute('data-model-offset', '[0,-0.95,0]');
    const areas = JSON.parse(model.getAttribute('data-body-map-areas') ?? '[]');
    expect(areas).toEqual(NEUTRAL_BODY_MAP_AREAS);
  });

  test('starts focused on the head without overriding saved body-area answers', () => {
    render(
      <QuestionnaireBodyMap
        question={{ id: 'where-were-you-affected', options: ['Head', 'Neck', 'Buttocks'] }}
        answer={['Neck', 'Buttocks']}
        onAnswerChange={jest.fn()}
      />,
    );

    const model = screen.getByTestId('body-map-3d-model');
    const head = NEUTRAL_BODY_MAP_AREAS.find((area) => area.name === 'Head')!;
    expect(model).toHaveAttribute('data-camera-position', JSON.stringify(head.position));
    expect(model).toHaveAttribute('data-camera-target', JSON.stringify(head.target));
    expect(screen.getByRole('checkbox', { name: 'Neck' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Buttocks' })).toBeChecked();
    expect(mockSetSelectedArea).not.toHaveBeenCalled();
    expect(jest.requireMock('gsap').gsap.to).not.toHaveBeenCalled();
  });

  test('selecting a spot on the model checks its matching option', () => {
    const onAnswerChange = jest.fn();
    render(
      <QuestionnaireBodyMap
        question={{ id: 'where-were-you-affected', options: ['Head', 'Neck'] }}
        answer={[]}
        onAnswerChange={onAnswerChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Head marker 1' }));

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
    expect(mockSetSelectedArea).toHaveBeenCalledWith(NEUTRAL_BODY_MAP_AREAS.find((area) => area.name === 'Neck'));
    expect(mockControls.object.position.set).toHaveBeenCalledWith(...NEUTRAL_BODY_MAP_AREAS.find((area) => area.name === 'Neck')!.position);
    expect(mockControls.target.set).toHaveBeenCalledWith(...NEUTRAL_BODY_MAP_AREAS.find((area) => area.name === 'Neck')!.target);
    expect(mockControls.update).toHaveBeenCalled();
    expect(jest.requireMock('gsap').gsap.killTweensOf).toHaveBeenCalledTimes(2);
    expect(jest.requireMock('gsap').gsap.to).not.toHaveBeenCalled();
  });

  test('either eye marker selects the same Eyes answer without duplicating it', () => {
    const onAnswerChange = jest.fn();
    function StatefulBodyMap() {
      const [answer, setAnswer] = React.useState(['Neck']);
      return <QuestionnaireBodyMap
        question={{ id: 'body-areas', options: ['Neck', 'Eyes'] }}
        answer={answer}
        onAnswerChange={(id, next) => { onAnswerChange(id, next); setAnswer(next); }}
      />;
    }
    render(<StatefulBodyMap />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Eyes marker 1' }));
    expect(screen.getByRole('checkbox', { name: /^Eyes$/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Select Eyes marker 2' }));
    expect(onAnswerChange).toHaveBeenLastCalledWith('body-areas', ['Neck', 'Eyes']);
    expect(screen.getByRole('checkbox', { name: /^Neck$/ })).toBeChecked();
    expect(screen.getAllByRole('checkbox', { name: /^Eyes$/ })).toHaveLength(1);
  });
});

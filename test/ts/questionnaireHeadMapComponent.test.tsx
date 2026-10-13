import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Area } from '@n-apt/three-d/hooks/useModel3D';

const mockControls = {
  object: { position: { set: jest.fn(), x: 0, y: 0, z: 0 } },
  target: { set: jest.fn(), x: 0, y: 0, z: 0 },
  update: jest.fn(),
};
const mockControlsRef = { current: mockControls };
const mockSetSelectedArea = jest.fn();
const mockModel3DProvider = jest.fn(({ children }: { children: React.ReactNode }) => children);

jest.mock('@n-apt/three-d/hooks/useModel3D', () => ({
  Model3DProvider: mockModel3DProvider,
  mockSetSelectedArea,
  useModel3D: () => ({ selectedArea: null, setSelectedArea: mockSetSelectedArea, controlsRef: mockControlsRef }),
}));
jest.mock('@n-apt/three-d/hooks/useHotspotEditor', () => ({
  Model3DInteractionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('gsap', () => ({ gsap: { to: jest.fn(), killTweensOf: jest.fn() } }));
jest.mock('@n-apt/three-d/modelAssetUrls', () => ({
  HUMAN_MODEL_NEUTRAL_GLB_URL: '/glb_models/human_model_neutral.glb',
}));
jest.mock('@n-apt/three-d/Model3DPerson', () => ({
  Model3DPerson: (props: { modelUrl: string; initialCameraPosition: number[]; initialCameraTarget: number[]; showTransformControls: boolean; areas: (Area & { markerShape?: string })[]; visibleAreaNames: string[]; onAreaSelect: (area: Area) => void }) => (
    <div
      data-testid="head-map-3d-model"
      data-model-url={props.modelUrl}
      data-camera-position={JSON.stringify(props.initialCameraPosition)}
      data-camera-target={JSON.stringify(props.initialCameraTarget)}
      data-transform-controls={String(props.showTransformControls)}
      data-head-map-areas={JSON.stringify(props.areas)}
      data-visible-area-names={JSON.stringify(props.visibleAreaNames)}
      data-head-movement-marker={props.areas.find(({ name }) => name.startsWith('Head movement'))?.markerStyle}
      data-head-movement-position={JSON.stringify(props.areas.find(({ name }) => name.startsWith('Head movement'))?.markerPosition)}
      data-breathing-markers={JSON.stringify(props.areas.find(({ name }) => name === 'Breathing')?.markerPositions)}
      data-breathing-camera={JSON.stringify(props.areas.find(({ name }) => name === 'Breathing')?.position)}
    >
      {props.areas.map((area) => (
        <button key={area.name} type="button" onClick={() => props.onAreaSelect(area)}>Select {area.name} marker</button>
      ))}
    </div>
  ),
}));

const { QuestionnaireHeadMap } = require('../../src/app-legal/components/QuestionnaireHeadMap') as typeof import('../../src/app-legal/components/QuestionnaireHeadMap');

describe('QuestionnaireHeadMap', () => {
  beforeEach(() => {
    mockModel3DProvider.mockClear();
    mockSetSelectedArea.mockClear();
    mockControls.object.position.set.mockClear();
    mockControls.target.set.mockClear();
    mockControls.update.mockClear();
    jest.requireMock('gsap').gsap.to.mockClear();
    jest.requireMock('gsap').gsap.killTweensOf.mockClear();
  });

  test('shows the neutral close-up and updates multiple affected-area checkboxes', () => {
    const onAnswerChange = jest.fn();
    const options = ['Mouth', 'Throat', 'Tongue', 'Jaw', 'Facial muscles', 'Eye muscles', 'Head movement (turns, jolts, etc.)', 'Breathing'];
    render(
      <QuestionnaireHeadMap
        question={{ id: '29g', options }}
        answer={['Mouth']}
        onAnswerChange={onAnswerChange}
      />,
    );

    expect(mockModel3DProvider).toHaveBeenCalledTimes(1);
    const model = screen.getByTestId('head-map-3d-model');
    expect(model).toHaveAttribute('data-model-url', '/glb_models/human_model_neutral.glb');
    expect(model).toHaveAttribute('data-transform-controls', 'false');
    expect(model).toHaveAttribute('data-visible-area-names', '["Mouth"]');
    const cameraPosition = JSON.parse(model.getAttribute('data-camera-position')!);
    expect(cameraPosition[2]).toBeLessThan(0.66);
    expect(screen.getByRole('group', { name: 'Select affected head areas' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mouth' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Throat' }));
    expect(onAnswerChange).toHaveBeenCalledWith('29g', ['Mouth', 'Throat']);
  });

  test('focuses the selected option and displays its marker on the model', () => {
    const onAnswerChange = jest.fn();
    const options = ['Mouth', 'Throat', 'Tongue', 'Jaw', 'Facial muscles', 'Eye muscles', 'Head movement (turns, jolts, etc.)', 'Breathing'];
    render(
      <QuestionnaireHeadMap
        question={{ id: '29g', options }}
        answer={[]}
        onAnswerChange={onAnswerChange}
      />,
    );

    const model = screen.getByTestId('head-map-3d-model');
    const areas = JSON.parse(model.getAttribute('data-head-map-areas') ?? '[]') as Area[];
    const mouth = areas.find(({ name }) => name === 'Mouth')!;
    const tongueArea = areas.find(({ name }) => name === 'Tongue')!;
    const mouthPoint = mouth.markerPosition!;
    const tonguePoint = tongueArea.markerPosition!;
    const distance = Math.hypot(mouthPoint[0] - tonguePoint[0], mouthPoint[1] - tonguePoint[1], mouthPoint[2] - tonguePoint[2]);
    expect(distance).toBeGreaterThan((mouth.markerRadius ?? 0) + (tongueArea.markerRadius ?? 0));
    expect(areas.map(({ name }) => name)).toEqual(options);

    fireEvent.click(screen.getByRole('button', { name: 'Select Mouth marker' }));
    expect(onAnswerChange).toHaveBeenCalledWith('29g', ['Mouth']);
    expect(mockSetSelectedArea).toHaveBeenCalledWith(mouth);
    const gsap = jest.requireMock('gsap').gsap;
    expect(gsap.to).toHaveBeenCalledWith(mockControls.object.position, expect.objectContaining({
      x: mouth.position[0], y: mouth.position[1], z: mouth.position[2], duration: 1.2,
    }));

    gsap.to.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tongue' }));
    expect(onAnswerChange).toHaveBeenLastCalledWith('29g', ['Tongue']);
    expect(gsap.to).toHaveBeenCalledWith(mockControls.object.position, expect.objectContaining({
      x: tongueArea.position[0], y: tongueArea.position[1], z: tongueArea.position[2], duration: 1.2,
    }));
  });

  test('uses a head-turn arrow and gives breathing nose and paired lung markers with a wider camera view', () => {
    render(
      <QuestionnaireHeadMap
        question={{ id: '29g', options: ['Head movement (turns, jolts, etc.)', 'Breathing'] }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );
    const model = screen.getByTestId('head-map-3d-model');
    expect(model).toHaveAttribute('data-head-movement-marker', 'rotation');
    expect(JSON.parse(model.getAttribute('data-head-movement-position') ?? '[]')).toEqual([0, 1.995, 0.18]);
    const breathingMarkers = JSON.parse(model.getAttribute('data-breathing-markers') ?? '[]');
    expect(breathingMarkers).toHaveLength(3);
    const breathingCamera = JSON.parse(model.getAttribute('data-breathing-camera') ?? '[]');
    expect(breathingCamera[2]).toBeGreaterThan(0.8);
  });

  test('places Vocal cords below Throat without overlapping their markers', () => {
    render(
      <QuestionnaireHeadMap
        question={{ id: '29g', options: ['Throat', 'Vocal cords'] }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );
    const areas = JSON.parse(screen.getByTestId('head-map-3d-model').getAttribute('data-head-map-areas') ?? '[]') as Area[];
    const throat = areas.find(({ name }) => name === 'Throat')!;
    const vocalCords = areas.find(({ name }) => name === 'Vocal cords')!;
    const throatMarker = throat.markerPosition!;
    const vocalCordsMarker = vocalCords.markerPosition!;
    const markerDistance = Math.hypot(
      throatMarker[0] - vocalCordsMarker[0],
      throatMarker[1] - vocalCordsMarker[1],
      throatMarker[2] - vocalCordsMarker[2],
    );

    expect(vocalCordsMarker[1]).toBeLessThan(throatMarker[1]);
    expect(markerDistance).toBeGreaterThan((throat.markerRadius ?? 0) + (vocalCords.markerRadius ?? 0));
  });

  test('animates selected framing and provides a one-click headshot return', () => {
    const options = ['Mouth', 'Breathing'];
    render(
      <QuestionnaireHeadMap
        question={{ id: '29g', options }}
        answer={[]}
        onAnswerChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mouth' }));
    const gsap = jest.requireMock('gsap').gsap;
    expect(gsap.to).toHaveBeenCalledTimes(2);
    expect(gsap.to).toHaveBeenCalledWith(mockControls.object.position, expect.objectContaining({ duration: 1.2, ease: 'power2.inOut' }));

    fireEvent.click(screen.getByRole('button', { name: 'Return model to headshot' }));
    expect(gsap.to).toHaveBeenCalledTimes(4);
    expect(gsap.to).toHaveBeenCalledWith(mockControls.object.position, expect.objectContaining({ x: 0, y: 1.95, z: 0.42 }));
  });
});

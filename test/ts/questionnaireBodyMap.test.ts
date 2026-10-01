import {
  addBodyMapSelection,
  findBodyMapArea,
  findBodyMapOptionForArea,
} from '../../src/app-legal/utils/questionnaireBodyMap';

const areas = [
  { name: 'Head', target: [0, 1, 0] },
  { name: 'Throat', target: [0, 0.5, 0] },
];

describe('questionnaire BodyMap selections', () => {
  test('resolves checklist labels to body areas without case sensitivity', () => {
    expect(findBodyMapArea('head', areas)).toBe(areas[0]);
    expect(findBodyMapArea('Neck', areas)).toBe(areas[1]);
    expect(findBodyMapArea('unknown', areas)).toBeNull();
    expect(findBodyMapOptionForArea('Throat', ['Head', 'Neck'])).toBe('Neck');
  });

  test('adds a clicked body area to the multi-select answer without removing other areas', () => {
    expect(addBodyMapSelection(['Head'], 'Neck')).toEqual(['Head', 'Neck']);
    expect(addBodyMapSelection(['Head'], 'Head')).toEqual(['Head']);
  });
});

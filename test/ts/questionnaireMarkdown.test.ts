import fs from 'node:fs';
import path from 'node:path';
import {
  groupQuestionPages,
  migrateQuestionnaireAnswers,
  parseQuestionnaireMarkdown,
} from '../../src/app-legal/utils/questionnaireMarkdown';
import {
  pageIndexFromQuestionnairePath,
  questionnairePathForPage,
} from '../../src/app-legal/utils/questionnaireRouting';

describe('questionnaire Markdown source', () => {
  test('parses each supported input and the inline BodyMap into ordered questions', () => {
    const questions = parseQuestionnaireMarkdown(`
- When did you first notice it?
  *date*

- What was the experience like?

- Was it intermittent or continual?
  *radio*
  - [ ] Intermittent
  - [ ] Continual but episodic

- What features did you experience?
  *options*
  - [ ] Heightened perception
  - [ ] Emotional changes

- Where were you affected?
  *Canvas::BodyMap*
  *options*
  - [ ] Head
  - [ ] Neck

- Which head areas were affected?
  *Canvas::HeadMap*
  *options*
  - [ ] Mouth
  - [ ] Throat
`);

    expect(questions).toEqual([
      expect.objectContaining({ id: '1', formattedId: 'Q1', text: 'When did you first notice it?', type: 'date', options: [] }),
      expect.objectContaining({ id: '2', formattedId: 'Q2', text: 'What was the experience like?', type: 'text', options: [] }),
      expect.objectContaining({ id: '3', formattedId: 'Q3', text: 'Was it intermittent or continual?', type: 'radio', options: ['Intermittent', 'Continual but episodic'] }),
      expect.objectContaining({ id: '4', formattedId: 'Q4', text: 'What features did you experience?', type: 'checkbox', options: ['Heightened perception', 'Emotional changes'] }),
      expect.objectContaining({ id: '5', formattedId: 'Q5', text: 'Where were you affected?', type: 'checkbox', options: ['Head', 'Neck'], canvas: 'BodyMap' }),
      expect.objectContaining({ id: '6', formattedId: 'Q6', text: 'Which head areas were affected?', type: 'checkbox', options: ['Mouth', 'Throat'], canvas: 'HeadMap' }),
    ]);
  });

  test('generates numeric IDs by order even when prompts repeat', () => {
    const questions = parseQuestionnaireMarkdown('- Frequency\n- Frequency');

    expect(questions.map(({ id }) => id)).toEqual(['1', '2']);
    expect(questions.map(({ formattedId }) => formattedId)).toEqual(['Q1', 'Q2']);
  });

  test('keeps each question as its own questionnaire step', () => {
    const questions = parseQuestionnaireMarkdown(`
- Short one
- Short two
- Where were you affected?
  *Canvas::BodyMap*
  *options*
  - [ ] Head
- Short three
`);

    expect(groupQuestionPages(questions).map((page) => page.map(({ id }) => id))).toEqual([
      ['1'],
      ['2'],
      ['3'],
      ['4'],
    ]);
  });

  test('parses nested subquestions with their own answer markers and choices', () => {
    const questions = parseQuestionnaireMarkdown(`
- Did this happen?
  *radio*
  - [ ] Yes
  - [ ] No
  - How often?
    *radio*
    - [ ] Daily
    - [ ] Weekly
  - Where were you affected?
    *Canvas::BodyMap*
    *options*
    - [ ] Head
    - [ ] Neck
- A separate question
`);

    expect(questions).toEqual([
      expect.objectContaining({ id: '1', formattedId: 'Q1', type: 'radio', options: ['Yes', 'No'], isSubQuestion: false }),
      expect.objectContaining({ id: '1a', formattedId: '1a)', type: 'radio', options: ['Daily', 'Weekly'], isSubQuestion: true, parentQuestionId: '1' }),
      expect.objectContaining({ id: '1b', formattedId: '1b)', type: 'checkbox', canvas: 'BodyMap', options: ['Head', 'Neck'], isSubQuestion: true, parentQuestionId: '1' }),
      expect.objectContaining({ id: '2', formattedId: 'Q2', isSubQuestion: false }),
    ]);

    expect(groupQuestionPages(questions).map((page) => page.map(({ id }) => id))).toEqual([
      ['1', '1a', '1b'],
      ['2'],
    ]);
  });

  test('migrates saved answers by normalized question text', () => {
    const questions = parseQuestionnaireMarkdown('-  Was it on?  \n- How did it feel?');
    const migrated = migrateQuestionnaireAnswers(
      { '1': 'Yes', '2': 'A buzzing feeling', 'stale-id': 'ignore' },
      questions,
      [
        { id: '1', text: 'Was it on?' },
        { id: '2', text: 'How did it feel?' },
      ],
    );

    expect(migrated).toEqual({ '1': 'Yes', '2': 'A buzzing feeling' });
  });

  test('migrates answers saved by the previous prompt-slug IDs', () => {
    const questions = parseQuestionnaireMarkdown('- Frequency\n- Frequency');
    const migrated = migrateQuestionnaireAnswers(
      { frequency: 'Daily', 'frequency-2': 'Weekly' },
      questions,
      [],
    );

    expect(migrated).toEqual({ '1': 'Daily', '2': 'Weekly' });
  });

  test('the authored questionnaire retains every legacy prompt and includes BodyMap and HeadMap regions', () => {
    const legacyQuestions = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), 'src/app-legal/data/questionnaire/questions.json'),
      'utf8',
    ));
    const markdown = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app-legal/data/questionnaire/questionnaire.md'),
      'utf8',
    );
    const questions = parseQuestionnaireMarkdown(markdown);

    expect(questions.filter(({ canvas }) => canvas === 'BodyMap')).toHaveLength(1);
    expect(questions.filter(({ canvas }) => canvas === 'HeadMap')).toHaveLength(1);
    expect(questions).toHaveLength(legacyQuestions.length + 3);
    for (const legacyQuestion of legacyQuestions) {
      expect(questions.some(({ text }) => text === legacyQuestion.text)).toBe(true);
    }
    const bodyMapQuestion = questions.find(({ canvas }) => canvas === 'BodyMap');
    expect(bodyMapQuestion).toEqual(expect.objectContaining({ id: '29f', formattedId: '29f)', isSubQuestion: true, parentQuestionId: '29' }));
    expect(bodyMapQuestion?.options).toContain('Head');
    expect(bodyMapQuestion?.options).toContain('Neck');
    const headMapQuestion = questions.find(({ canvas }) => canvas === 'HeadMap');
    expect(headMapQuestion).toEqual(expect.objectContaining({
      id: '29g',
      formattedId: '29g)',
      text: 'Which head areas were affected?',
      type: 'checkbox',
      options: ['Mouth', 'Throat', 'Vocal cords', 'Tongue', 'Jaw', 'Facial muscles', 'Eye muscles', 'Head movement (turns, jolts, etc.)', 'Breathing'],
      isSubQuestion: true,
      parentQuestionId: '29',
    }));
    const effectsQuestion = questions.find(({ canvas }) => canvas === 'HeadEffects');
    expect(effectsQuestion).toEqual(expect.objectContaining({
      id: '29h',
      text: 'What kinds of effects or feelings did you experience?',
      type: 'checkbox',
      options: [
        'Perceptual',
        'Compressed',
        'Chemical',
        'Somatic (sensations, pressure, jolts)',
        'Autonomic (manipulating involuntary functions of your body)',
      ],
    }));
    expect(questions.filter(({ isSubQuestion }) => isSubQuestion)).toHaveLength(37);
    const pages = groupQuestionPages(questions);
    expect(pages.find((page) => page[0]?.id === '25')?.map(({ id }) => id)).toEqual(['25', '25a', '25b', '25c', '25d', '25e']);
    expect(pages.find((page) => page[0]?.id === '29')?.map(({ id }) => id)).toEqual(['29', '29a', '29b', '29c', '29d', '29e', '29f', '29g', '29h']);
    for (const legacyQuestion of legacyQuestions) {
      expect(questions.find(({ text, options }) => text === legacyQuestion.text && JSON.stringify(options) === JSON.stringify(legacyQuestion.options.filter(Boolean)))).toBeDefined();
    }
  });
});

describe('questionnaire URL routing', () => {
  const pages = [['1'], ['25', '25a', '25b'], ['29', '29a', '29f']];

  test('uses each generated question ID in its own URL and a dedicated summary path', () => {
    expect(questionnairePathForPage(0, pages)).toBe('/questionnaire/1');
    expect(questionnairePathForPage(1, pages)).toBe('/questionnaire/25');
    expect(questionnairePathForPage(1, pages, '25a')).toBe('/questionnaire/25a');
    expect(questionnairePathForPage(pages.length, pages)).toBe('/questionnaire/summary');
  });

  test('restores the step from a question URL, summary URL, or encoded identifier', () => {
    expect(pageIndexFromQuestionnairePath('/questionnaire/25', pages)).toBe(1);
    expect(pageIndexFromQuestionnairePath('/questionnaire/25a', pages)).toBe(1);
    expect(pageIndexFromQuestionnairePath('/questionnaire/summary', pages)).toBe(pages.length);
    expect(pageIndexFromQuestionnairePath('/questionnaire/29f/', pages)).toBe(2);
    expect(pageIndexFromQuestionnairePath('/questionnaire/missing', pages)).toBeNull();
    expect(pageIndexFromQuestionnairePath('/questionnaire', pages)).toBeNull();
  });
});

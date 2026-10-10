import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import type { Root } from 'mdast';
import { unified } from 'unified';
import remarkQuestionnaireBlocks, { type QuestionnaireDraft } from './remarkQuestionnaireBlocks';

export type QuestionnaireAnswerType = 'text' | 'date' | 'radio' | 'checkbox';

export type QuestionnaireQuestion = {
  id: string;
  formattedId: string;
  text: string;
  type: QuestionnaireAnswerType;
  options: string[];
  canvas?: string;
  isSubQuestion: boolean;
  parentQuestionId?: string;
};

type LegacyQuestion = { id: string; text: string };

function alphabeticSuffix(index: number): string {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

function normalizeQuestionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function questionSlug(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return slug || 'question';
}

export function parseQuestionnaireMarkdown(markdown: string): QuestionnaireQuestion[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkQuestionnaireBlocks);
  const tree = processor.runSync(processor.parse(markdown)) as Root & {
    data?: Root['data'] & { questionnaireDrafts?: QuestionnaireDraft[] };
  };
  const drafts = tree.data?.questionnaireDrafts ?? [];

  const ids = drafts.map((draft) => {
    if (draft.parentIndex === undefined) return String(draft.topLevelIndex);
    const parentQuestion = drafts[draft.parentIndex];
    return `${parentQuestion?.topLevelIndex ?? ''}${alphabeticSuffix(draft.siblingIndex ?? 0)}`;
  });

  return drafts.map((draft, index) => {
    const parentIndex = draft.parentIndex;
    const isSubQuestion = parentIndex !== undefined;
    const parentQuestion = parentIndex === undefined ? undefined : drafts[parentIndex];
    const formattedId = isSubQuestion
      ? `${parentQuestion?.topLevelIndex ?? ''}${alphabeticSuffix(draft.siblingIndex ?? 0)})`
      : `Q${draft.topLevelIndex}`;
    const question = {
      ...draft,
      id: ids[index],
      formattedId,
      type: draft.type ?? 'text',
      isSubQuestion,
      ...(parentIndex === undefined ? {} : { parentQuestionId: ids[parentIndex] }),
    };

    delete (question as Partial<typeof question>).parentIndex;
    delete (question as Partial<typeof question>).siblingIndex;
    delete (question as Partial<typeof question>).topLevelIndex;
    return question;
  });
}

export function groupQuestionPages<T extends { id: string; isSubQuestion?: boolean; parentQuestionId?: string }>(questions: T[]): T[][] {
  const pages: T[][] = [];
  const pageByQuestionId = new Map<string, T[]>();

  for (const question of questions) {
    if (!question.isSubQuestion || !question.parentQuestionId) {
      const page = [question];
      pages.push(page);
      pageByQuestionId.set(question.id, page);
      continue;
    }

    const parentPage = pageByQuestionId.get(question.parentQuestionId);
    if (parentPage) parentPage.push(question);
    else pages.push([question]);
  }

  return pages;
}

export function migrateQuestionnaireAnswers(
  savedAnswers: Record<string, unknown>,
  questions: QuestionnaireQuestion[],
  legacyQuestions: LegacyQuestion[],
): Record<string, unknown> {
  const savedByText = new Map<string, unknown[]>();

  for (const legacyQuestion of legacyQuestions) {
    const answer = savedAnswers[legacyQuestion.id];
    if (answer === undefined) continue;
    const key = normalizeQuestionText(legacyQuestion.text);
    const values = savedByText.get(key) ?? [];
    values.push(answer);
    savedByText.set(key, values);
  }

  const occurrenceByText = new Map<string, number>();
  const previousSlugOccurrences = new Map<string, number>();
  const migrated: Record<string, unknown> = {};

  for (const question of questions) {
    const key = normalizeQuestionText(question.text);
    const occurrence = occurrenceByText.get(key) ?? 0;
    occurrenceByText.set(key, occurrence + 1);

    const slug = questionSlug(question.text);
    const slugOccurrence = previousSlugOccurrences.get(slug) ?? 0;
    previousSlugOccurrences.set(slug, slugOccurrence + 1);
    const previousGeneratedId = slugOccurrence === 0 ? slug : `${slug}-${slugOccurrence + 1}`;

    if (savedAnswers[question.id] !== undefined) {
      migrated[question.id] = savedAnswers[question.id];
      continue;
    }

    if (savedAnswers[previousGeneratedId] !== undefined) {
      migrated[question.id] = savedAnswers[previousGeneratedId];
      continue;
    }

    const answers = savedByText.get(key);
    if (answers && occurrence < answers.length) migrated[question.id] = answers[occurrence];
  }

  return migrated;
}

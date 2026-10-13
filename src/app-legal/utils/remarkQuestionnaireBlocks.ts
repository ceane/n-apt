import type { ListItem, Root } from 'mdast';
import type { Plugin } from 'unified';

export type QuestionnaireDraft = {
  text: string;
  type?: 'text' | 'date' | 'radio' | 'checkbox';
  options: string[];
  canvas?: string;
  parentIndex?: number;
  siblingIndex?: number;
  topLevelIndex?: number;
};

type QuestionnaireRoot = Root & {
  data?: Root['data'] & { questionnaireDrafts?: QuestionnaireDraft[] };
};

type MdastNode = {
  type?: string;
  value?: string;
  checked?: boolean | null;
  children?: MdastNode[];
};

function inlineText(node: MdastNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return node.children?.map(inlineText).join('') ?? '';
}

function itemText(item: ListItem): string {
  const paragraph = item.children.find((child) => child.type === 'paragraph');
  return paragraph ? inlineText(paragraph as MdastNode).trim() : '';
}

function itemChildren(item: ListItem): MdastNode[] {
  return item.children as MdastNode[];
}

function commentDirectives(item: ListItem): string[] {
  return itemChildren(item)
    .flatMap((child) => child.type === 'paragraph' ? child.children ?? [] : [child])
    .filter((child) => child.type === 'html')
    .map((child) => (child.value ?? '').match(/^\s*<!--\s*(.*?)\s*-->\s*$/)?.[1]?.trim() ?? '')
    .filter(Boolean);
}

function optionItems(item: ListItem): ListItem[] {
  return itemChildren(item)
    .filter((child) => child.type === 'list')
    .flatMap((list) => list.children ?? [])
    .filter((child) => child.type === 'listItem' && child.checked !== null) as ListItem[];
}

function nestedQuestionItems(item: ListItem): ListItem[] {
  return itemChildren(item)
    .filter((child) => child.type === 'list')
    .flatMap((list) => list.children ?? [])
    .filter((child) => child.type === 'listItem' && child.checked === null) as ListItem[];
}

function applyDirectives(draft: QuestionnaireDraft, item: ListItem): void {
  for (const marker of commentDirectives(item)) {
    const normalized = marker.toLocaleLowerCase();
    if (normalized === 'date') draft.type = 'date';
    else if (normalized === 'radio') draft.type = 'radio';
    else if (normalized === 'options') draft.type = 'checkbox';
    else {
      const canvasMatch = marker.match(/^Canvas::([A-Za-z][A-Za-z0-9_-]*)$/i);
      if (canvasMatch) draft.canvas = canvasMatch[1];
    }
  }
}

function appendOptions(draft: QuestionnaireDraft, item: ListItem): void {
  for (const option of optionItems(item)) {
    const text = itemText(option);
    if (text) draft.options.push(text);
  }
}

function parseQuestionItems(
  items: ListItem[],
  drafts: QuestionnaireDraft[],
  parentIndex?: number,
): void {
  let topLevelIndex = drafts.filter((draft) => draft.parentIndex === undefined).length;
  const siblingIndex = { value: 0 };

  for (const item of items) {
    if (item.checked !== null) continue;
    const text = itemText(item);
    if (!text) continue;

    const draft: QuestionnaireDraft = {
      text,
      options: [],
      ...(parentIndex === undefined
        ? { topLevelIndex: ++topLevelIndex }
        : { parentIndex, siblingIndex: siblingIndex.value++ }),
    };
    applyDirectives(draft, item);
    appendOptions(draft, item);
    const draftIndex = drafts.push(draft) - 1;

    if (parentIndex === undefined) {
      parseQuestionItems(nestedQuestionItems(item), drafts, draftIndex);
    }
  }
}

/**
 * Reads question, answer-type, option, and canvas directives from Markdown AST.
 * Directives use HTML comments so they stay invisible in rendered Markdown.
 */
const remarkQuestionnaireBlocks: Plugin<[], Root> = () => (tree) => {
  const drafts: QuestionnaireDraft[] = [];
  const rootLists = (tree.children as MdastNode[])
    .filter((node) => node.type === 'list')
    .flatMap((list) => list.children ?? [])
    .filter((item) => item.type === 'listItem' && item.checked === null) as ListItem[];

  parseQuestionItems(rootLists, drafts);
  (tree as QuestionnaireRoot).data = {
    ...(tree.data ?? {}),
    questionnaireDrafts: drafts,
  };
};

export default remarkQuestionnaireBlocks;

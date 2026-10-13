export type QuestionnairePages = string[][];

export const QUESTIONNAIRE_SUMMARY_PATH = '/questionnaire/summary';

export function questionnairePathForPage(pageIndex: number, pages: QuestionnairePages, questionId?: string): string {
  if (pageIndex >= pages.length) return QUESTIONNAIRE_SUMMARY_PATH;
  const routeId = questionId ?? pages[pageIndex]?.[0];
  return routeId ? `/questionnaire/${encodeURIComponent(routeId)}` : '/questionnaire';
}

export function questionIdFromQuestionnairePath(pathname: string, pages: QuestionnairePages): string | null {
  const match = pathname.match(/^\/questionnaire\/([^/]+)\/?$/);
  if (!match) return null;

  let routeKey: string;
  try {
    routeKey = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (routeKey === 'summary') return null;
  return pages.find((page) => page.includes(routeKey)) ? routeKey : null;
}

export function pageIndexFromQuestionnairePath(
  pathname: string,
  pages: QuestionnairePages,
): number | null {
  const match = pathname.match(/^\/questionnaire\/([^/]+)\/?$/);
  if (!match) return null;

  let routeKey: string;
  try {
    routeKey = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (routeKey === 'summary') return pages.length;
  const pageIndex = pages.findIndex((page) => page.includes(routeKey));
  return pageIndex >= 0 ? pageIndex : null;
}

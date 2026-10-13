import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

jest.mock('../../src/app-legal/hooks/useQuestionnaire', () => ({
  useQuestionnaire: jest.fn(),
}));

jest.mock('../../src/app-legal/components/QuestionnairePanels', () => ({
  QuestionnaireQuestions: ({ questionnaire }: { questionnaire: { currentPage: number } }) => (
    <div data-testid="questionnaire-flow">
      <section id="29f">Question page {questionnaire.currentPage + 1}</section>
    </div>
  ),
  QuestionnaireSummary: () => <div>Questionnaire summary</div>,
}));

import { useQuestionnaire } from '../../src/app-legal/hooks/useQuestionnaire';
import QuestionnaireRoute from '../../src/app-legal/routes/QuestionnaireRoute';

const mockedUseQuestionnaire = jest.mocked(useQuestionnaire);

describe('QuestionnaireRoute', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockedUseQuestionnaire.mockReturnValue({
      currentPage: 28,
      totalPages: 33,
      scrollToId: '29f',
      pages: [['29f']],
      currentQuestions: [],
      summaryItems: [],
      setScrollToId: jest.fn(),
      resetQuestionnaire: jest.fn(),
    } as never);
  });

  function renderRoute() {
    return render(
      <MemoryRouter initialEntries={['/questionnaire/29f']}>
        <QuestionnaireRoute />
      </MemoryRouter>,
    );
  }

  test('keeps disclaimer acknowledgement through a route remount during hot reload', () => {
    const firstMount = renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'I understand & proceed' }));
    expect(screen.getByTestId('questionnaire-flow')).toHaveTextContent('Question page 29');

    firstMount.unmount();
    renderRoute();

    expect(screen.queryByRole('button', { name: 'I understand & proceed' })).not.toBeInTheDocument();
    expect(screen.getByTestId('questionnaire-flow')).toHaveTextContent('Question page 29');
  });
});

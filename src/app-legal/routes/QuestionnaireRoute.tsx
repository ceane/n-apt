// @ts-nocheck
import { useEffect } from 'react';
import { useQuestionnaire } from '../hooks/useQuestionnaire';
import { QuestionnaireQuestions, QuestionnaireSummary } from '../components/QuestionnairePanels';

export default function QuestionnaireRoute() {
  const questionnaire = useQuestionnaire();

  useEffect(() => {
    if (!questionnaire.scrollToId) {
      return;
    }
    const element = document.getElementById(questionnaire.scrollToId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [questionnaire.currentPage, questionnaire.scrollToId]);

  return (
    <div className="route-stack">
      <header className="route-header">
        <div>
          <p className="eyebrow">Route</p>
          <h2 className="route-title">Questionnaire</h2>
          <p className="muted">Question flow and summary are now managed through a hook and a worker-backed route.</p>
        </div>
        {questionnaire.currentPage >= questionnaire.totalPages ? (
          <span className="tag">Summary</span>
        ) : (
          <span className="tag">Page {questionnaire.currentPage + 1} of {questionnaire.totalPages}</span>
        )}
      </header>

      {questionnaire.currentPage >= questionnaire.totalPages ? (
        <QuestionnaireSummary questionnaire={questionnaire} onRestart={questionnaire.resetQuestionnaire} />
      ) : (
        <QuestionnaireQuestions questionnaire={questionnaire} />
      )}
    </div>
  );
}

// @ts-nocheck
import { useEffect, useState } from 'react';
import { useQuestionnaire } from '../hooks/useQuestionnaire';
import { QuestionnaireQuestions, QuestionnaireSummary } from '../components/QuestionnairePanels';

export default function QuestionnaireRoute() {
  const questionnaire = useQuestionnaire();
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(false);
  const isSummary = questionnaire.currentPage >= questionnaire.totalPages;

  useEffect(() => {
    if (!questionnaire.scrollToId) {
      return;
    }
    const element = document.getElementById(questionnaire.scrollToId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      questionnaire.setScrollToId('');
    }
  }, [questionnaire.currentPage, questionnaire.currentQuestions, questionnaire.scrollToId, questionnaire.setScrollToId]);

  if (!hasAcceptedDisclaimer) {
    return (
      <div className="route-stack">
        <section className="questionnaire-disclaimer" aria-labelledby="questionnaire-disclaimer-title">
          <h2 className="route-title" id="questionnaire-disclaimer-title">Experience &amp; Evidence Questionnaire</h2>
          <div className="muted">
            <p>This questionnaire is intended to document experiences, observations, and potential evidence concerning alleged government surveillance, interference, or other potentially unlawful conduct.</p>
            <p>Please describe events as accurately as you can based on your own knowledge and recollection. Separate what you personally observed from what you believe or infer may have caused it. If you are uncertain about a date, person, technology, agency, or explanation, indicate that uncertainty rather than guessing.</p>
            <p>Where possible, identify supporting material such as photographs, recordings, communications, medical or technical records, contemporaneous notes, witnesses, device logs, radio-frequency captures, government correspondence, or other documentation.</p>
            <p>Completing this questionnaire does not establish that any allegation, explanation, responsible party, or technical mechanism is true. Its purpose is to create a structured record that can be evaluated alongside independently verifiable evidence.</p>
            <p><strong>Participation is voluntary.</strong> If you do not wish to participate, do not understand the purpose of this questionnaire or what is being asked of you, or do not feel comfortable providing these responses, please do not proceed. You should only continue if you understand the questionnaire and choose to participate.</p>
          </div>
          <div className="button-row">
            <button className="button primary" type="button" onClick={() => setHasAcceptedDisclaimer(true)}>
              I understand &amp; proceed
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack">
      <header className="route-header">
        <div>
          <h2 className="route-title">{isSummary ? 'Review Your Responses' : 'Questionnaire'}</h2>
          {isSummary ? (
            <div className="muted summary-intro">
              <p>Before printing or exporting, review your answers and make sure they accurately describe your experiences.</p>
              <p>
                Check that you have included important details where you remember them, such as{' '}
                <strong>what happened, when it happened, where you were, what you experienced, how long it lasted, how often it occurred, and what effects it had on you</strong>.
              </p>
              <p>If you are unsure about a detail, it is okay to say so. You can edit any response before printing.</p>
              <p>Your responses below will appear in the printed copy.</p>
            </div>
          ) : (
            <p className="muted">
              {questionnaire.currentPage === 0
                ? 'Answer the questions below at your own pace. You can review and edit your responses before printing.'
                : 'Continue with the questions below. You can review and edit your responses before printing.'}
            </p>
          )}
        </div>
        {!isSummary && (
          <span className="tag">Page {questionnaire.currentPage + 1} of {questionnaire.totalPages}</span>
        )}
      </header>

      {isSummary ? (
        <QuestionnaireSummary questionnaire={questionnaire} onRestart={questionnaire.resetQuestionnaire} />
      ) : (
        <QuestionnaireQuestions questionnaire={questionnaire} />
      )}
    </div>
  );
}

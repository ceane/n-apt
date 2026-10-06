// @ts-nocheck
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuestionnaire } from '../hooks/useQuestionnaire';
import { QuestionnaireQuestions, QuestionnaireSummary } from '../components/QuestionnairePanels';
import { questionIdFromQuestionnairePath } from '../utils/questionnaireRouting';

const DISCLAIMER_ACCEPTED_KEY = 'questionnaire.disclaimerAccepted';

function readDisclaimerAcceptance() {
  try {
    return window.sessionStorage.getItem(DISCLAIMER_ACCEPTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function QuestionnaireRoute() {
  const questionnaire = useQuestionnaire();
  const location = useLocation();
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(readDisclaimerAcceptance);
  const [deepLinkScrollSpace, setDeepLinkScrollSpace] = useState(0);
  const deepLinkScrollSpaceRef = useRef(0);
  const isSummary = questionnaire.currentPage >= questionnaire.totalPages;
  const routeQuestionId = questionIdFromQuestionnairePath(location.pathname, questionnaire.pages);

  useLayoutEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    deepLinkScrollSpaceRef.current = 0;
    setDeepLinkScrollSpace(0);
  }, [location.pathname]);

  function acceptDisclaimer() {
    try {
      window.sessionStorage.setItem(DISCLAIMER_ACCEPTED_KEY, 'true');
    } catch {
      // Keep the current interaction usable when browser storage is unavailable.
    }
    setHasAcceptedDisclaimer(true);
  }

  useEffect(() => {
    if (!hasAcceptedDisclaimer || !routeQuestionId) {
      return;
    }
    if (!questionnaire.currentQuestions.some((question) => question.id === routeQuestionId)) {
      return;
    }

    let frame = 0;
    let scrollFrame = 0;
    let stopObserving = 0;
    let observer: MutationObserver | undefined;
    const element = document.getElementById(routeQuestionId);
    const contentPane = element?.closest('.program-tools-content');
    const scrollContainer = contentPane && contentPane.scrollHeight > contentPane.clientHeight + 1
      ? contentPane
      : document.scrollingElement;
    if (!element || !scrollContainer) return;

    const alignTarget = (behavior: ScrollBehavior) => {
      const elementBounds = element.getBoundingClientRect();
      const isDocumentScroller = scrollContainer === document.scrollingElement;
      const containerTop = isDocumentScroller ? 0 : scrollContainer.getBoundingClientRect().top;
      const targetTop = scrollContainer.scrollTop + elementBounds.top - containerTop - 24;
      const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const neededSpace = Math.max(0, targetTop - maxScrollTop);
      if (neededSpace > deepLinkScrollSpaceRef.current + 1) {
        const nextSpace = Math.ceil(neededSpace + 24);
        deepLinkScrollSpaceRef.current = nextSpace;
        setDeepLinkScrollSpace(nextSpace);
      }
      scrollContainer.scrollTo({ top: targetTop, behavior });
    };

    observer = new MutationObserver(() => alignTarget('auto'));
    observer.observe(scrollContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    frame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        alignTarget('smooth');
        // Lazy canvas modules above the target can expand after the first paint.
        // Keep the deep link aligned while their fallback content is replaced.
        stopObserving = window.setTimeout(() => {
          observer?.disconnect();
          questionnaire.setScrollToId('');
        }, 1800);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(stopObserving);
      observer?.disconnect();
    };
  }, [hasAcceptedDisclaimer, location.pathname, questionnaire.currentPage, questionnaire.currentQuestions, questionnaire.pages, questionnaire.setScrollToId, routeQuestionId]);

  if (!hasAcceptedDisclaimer) {
    return (
      <div className="route-stack questionnaire-route">
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
            <button className="button primary" type="button" onClick={acceptDisclaimer}>
              I understand &amp; proceed
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack questionnaire-route" style={{ paddingBottom: deepLinkScrollSpace || undefined }}>
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

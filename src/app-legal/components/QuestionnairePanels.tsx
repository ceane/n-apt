// @ts-nocheck
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lazy, Suspense } from 'react';
import styled from 'styled-components';
import { downloadQuestionnairePdf } from '../utils/exportQuestionnairePdf';
import { dateAnswerInputValue, dateAnswerText, isNaturalDateMonth, monthAutocompleteSuggestions, parseNaturalDate } from '../utils/naturalDate';

const QuestionnaireBodyMap = lazy(() => import('./QuestionnaireBodyMap').then((module) => ({ default: module.QuestionnaireBodyMap })));
const QuestionnaireHeadMap = lazy(() => import('./QuestionnaireHeadMap').then((module) => ({ default: module.QuestionnaireHeadMap })));
const QuestionnaireHeadEffects = lazy(() => import('./QuestionnaireHeadEffects').then((module) => ({ default: module.QuestionnaireHeadEffects })));

const SectionCard = styled.section`
  padding: 24px;
  border-radius: 24px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const QuestionCard = styled.article`
  display: grid;
  gap: 8px;
  padding: 16px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  ${({ $sub }) => $sub && `
    margin-left: clamp(36px, 5vw, 64px);
    padding-left: 16px;
    border-left: 2px solid #e5e7eb;
  `}
`;

const SummaryCard = styled.article`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 6px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  gap: 4px;
  ${({ $sub }) => $sub && `
    margin-left: clamp(36px, 5vw, 64px);
    padding-left: 12px;
    border-left: 2px solid #e5e7eb;
  `}
  break-inside: avoid;
  page-break-inside: avoid;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  align-content: start;
  gap: 8px;
`;

const SummaryPages = styled.div`
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  align-items: start;
  gap: 24px;
  overflow: auto;
`;

const SummaryPageFrame = styled.div`
  position: relative;
  width: min(100%, 8.5in);
  aspect-ratio: 8.5 / 11;
  container-type: inline-size;
`;

const SummaryPage = styled.section`
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  box-sizing: border-box;
  width: 8.5in;
  height: 11in;
  padding: 0.5in;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.08);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  transform: scale(calc(100cqw / 8.5in));
  transform-origin: top left;
`;

const SummaryMeasure = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  gap: 8px;
  box-sizing: border-box;
  width: calc(7.5in - 2px);
  height: calc(10in - 2px);
  overflow: hidden;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  visibility: hidden;
  pointer-events: none;
`;

const SummaryHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
`;

const SummaryAnswerBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
  .summary-question-number,
  .summary-answer-label {
    color: #6b7280;
    font-size: 0.78em;
    font-weight: 600;
  }
  .summary-answer-label {
    color: #c4cbd4;
    font-weight: 500;
  }
  .summary-question-text {
    color: #1f2937;
    font-weight: 600;
  }
  .summary-answer-label {
    margin-top: 4px;
  }
  .summary-answer-value {
    color: #111827;
    font-size: 0.9em;
    font-weight: 400;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
`;

const OptionList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  ${({ $inline }) => $inline && 'flex-direction: row;'}
`;

const Tag = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 16px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #111827;
  cursor: pointer;
  input {
    accent-color: #2563eb;
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 12px;
`;

const PrimaryButton = styled.button`
  padding: 10px 20px;
  border-radius: 9999px;
  border: none;
  background: #2563eb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled.button`
  padding: 10px 20px;
  border-radius: 9999px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  font-weight: 600;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const StyledInput = styled.input`
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
`;

const DateInputGroup = styled.div`
  position: relative;
  display: grid;
  gap: 8px;
`;

const DateSuggestions = styled.div`
  position: absolute;
  z-index: 10;
  top: 42px;
  left: 0;
  display: grid;
  min-width: 220px;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 20px rgba(17, 24, 39, 0.12);
`;

const DateSuggestion = styled.button`
  padding: 8px 10px;
  border: 0;
  border-radius: 5px;
  background: ${({ $active }) => ($active ? '#eff6ff' : '#ffffff')};
  color: #374151;
  text-align: left;
  cursor: pointer;
  &:hover { background: #eff6ff; }
`;

const DateInterpretation = styled.p`
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
  line-height: 1.5;
`;

const StyledTextArea = styled.textarea`
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  resize: vertical;
`;

export function QuestionInput({
  question,
  answer,
  onRadioChange = () => {},
  onCheckboxChange = () => {},
  onDateChange = () => {},
  onTextChange = () => {},
}: {
  question: any;
  answer: any;
  onRadioChange?: (questionId: string, value: string) => void;
  onCheckboxChange?: (questionId: string, value: string) => void;
  onDateChange?: (questionId: string, value: any) => void;
  onTextChange?: (questionId: string, value: string) => void;
}) {
  if (question.type === 'radio') {
    return (
      <OptionList $inline>
        {question.options.map((option) => (
          <Tag key={option}>
            <input type="radio" name={question.id} checked={answer === option} onChange={() => onRadioChange(question.id, option)} />
            {option}
          </Tag>
        ))}
      </OptionList>
    );
  }

  if (question.type === 'checkbox') {
    return (
      <OptionList>
        {question.options.map((option) => (
          <Tag key={option}>
            <input type="checkbox" checked={answer?.includes(option) || false} onChange={() => onCheckboxChange(question.id, option)} />
            {option}
          </Tag>
        ))}
      </OptionList>
    );
  }

  if (question.type === 'date') {
    return <NaturalDateInput question={question} answer={answer} onDateChange={onDateChange} />;
  }

  return <StyledTextArea rows="3" value={answer || ''} onChange={(event) => onTextChange(question.id, event.target.value)} />;
}

function NaturalDateInput({ question, answer, onDateChange }) {
  const value = dateAnswerInputValue(answer);
  const interpretation = parseNaturalDate(value);
  const [hasBlurred, setHasBlurred] = useState(false);
  const [timedOutValue, setTimedOutValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const monthOnly = isNaturalDateMonth(value);
  const suggestions = monthAutocompleteSuggestions(value);

  useEffect(() => {
    if (!value || interpretation) return undefined;

    const timeout = window.setTimeout(() => setTimedOutValue(value), 15_000);
    return () => window.clearTimeout(timeout);
  }, [value, Boolean(interpretation)]);

  const chooseMonth = (month) => {
    setHasBlurred(false);
    setActiveSuggestionIndex(-1);
    onDateChange(question.id, month);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Tab' && suggestions.length === 1) {
      event.preventDefault();
      chooseMonth(suggestions[0]);
      return;
    }
    if (event.key === 'Tab' && suggestions.length > 1) {
      event.preventDefault();
      setActiveSuggestionIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setActiveSuggestionIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setActiveSuggestionIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter' && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
      event.preventDefault();
      chooseMonth(suggestions[activeSuggestionIndex]);
    }
  };

  return (
    <DateInputGroup>
      <StyledInput
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="e.g., May 2021, early/mid/late month, or a season"
        aria-label="Date or approximate date"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isFocused && suggestions.length > 0}
        aria-controls={`questionnaire-month-suggestions-${question.id}`}
        aria-activedescendant={activeSuggestionIndex >= 0 ? `questionnaire-month-option-${question.id}-${activeSuggestionIndex}` : undefined}
        value={value}
        onChange={(event) => {
          setHasBlurred(false);
          setActiveSuggestionIndex(-1);
          onDateChange(question.id, parseNaturalDate(event.target.value) || event.target.value);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          setHasBlurred(true);
          setActiveSuggestionIndex(-1);
        }}
        onKeyDown={handleKeyDown}
      />
      {isFocused && suggestions.length > 0 && (
        <DateSuggestions id={`questionnaire-month-suggestions-${question.id}`} role="listbox" aria-label="Month suggestions">
          {suggestions.map((month, index) => (
            <DateSuggestion
              id={`questionnaire-month-option-${question.id}-${index}`}
              key={month}
              type="button"
              role="option"
              aria-selected={index === activeSuggestionIndex}
              $active={index === activeSuggestionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseMonth(month)}
            >
              {month}
            </DateSuggestion>
          ))}
        </DateSuggestions>
      )}
      <DateInterpretation aria-live="polite">
        {interpretation
          ? dateAnswerText(interpretation)
          : value && (hasBlurred || timedOutValue === value)
            ? monthOnly
              ? 'Add a year to this month to record the date range.'
              : 'Could not identify that date. Try a month and year, or a complete date with a year.'
            : 'Try an exact date, early/mid/late month, or a season such as Summer 2020.'}
      </DateInterpretation>
    </DateInputGroup>
  );
}

export function QuestionnaireQuestions({ questionnaire }) {
  if (!questionnaire) {
    return null;
  }
  const currentQuestions = questionnaire.currentQuestions ?? [];
  return (
    <SectionCard>
      {currentQuestions.map((question) => (
        <QuestionCard key={question.id} id={question.id} $sub={question.isSubQuestion}>
          <div className="question-prompt">
            <span className="question-number">{summaryQuestionNumber(question)}</span>
            <h3>{question.text}</h3>
          </div>
          <strong className="question-answer-label">Answer</strong>
          {question.canvas === 'BodyMap' ? (
            <Suspense fallback={<p role="status">Loading body map…</p>}>
              <QuestionnaireBodyMap
                question={question}
                answer={questionnaire.answers[question.id]}
                onAnswerChange={questionnaire.setAnswer}
              />
            </Suspense>
          ) : question.canvas === 'HeadMap' ? (
            <Suspense fallback={<p role="status">Loading head view…</p>}>
              <QuestionnaireHeadMap
                question={question}
                answer={questionnaire.answers[question.id]}
                onAnswerChange={questionnaire.setAnswer}
              />
            </Suspense>
          ) : question.canvas === 'HeadEffects' ? (
            <Suspense fallback={<p role="status">Loading head effects view…</p>}>
              <QuestionnaireHeadEffects
                question={question}
                answer={questionnaire.answers[question.id]}
                onAnswerChange={questionnaire.setAnswer}
              />
            </Suspense>
          ) : (
            <QuestionInput
              question={question}
              answer={questionnaire.answers[question.id]}
              onRadioChange={questionnaire.setAnswer}
              onCheckboxChange={questionnaire.toggleCheckbox}
              onDateChange={questionnaire.setAnswer}
              onTextChange={questionnaire.setAnswer}
            />
          )}
        </QuestionCard>
      ))}
      <ButtonRow>
        <SecondaryButton type="button" disabled={questionnaire.isFirstPage} onClick={questionnaire.goPrevious}>Previous</SecondaryButton>
        <SecondaryButton type="button" onClick={questionnaire.backToSummary}>Back to Summary</SecondaryButton>
        {questionnaire.isLastPage ? (
          <PrimaryButton type="button" onClick={questionnaire.submit}>Submit</PrimaryButton>
        ) : (
          <PrimaryButton type="button" onClick={questionnaire.goNext}>Next</PrimaryButton>
        )}
      </ButtonRow>
    </SectionCard>
  );
}

function summaryQuestionNumber(question) {
  if (question.isSubQuestion) return question.formattedId;
  return String(question.formattedId ?? '').replace(/^Q(?=\d)/, 'Question ');
}

function summaryAnswer(question) {
  if (!question.answer || (Array.isArray(question.answer) && question.answer.length === 0)) return 'No answer provided';
  return dateAnswerText(question.answer);
}

export function QuestionnaireSummary({ questionnaire = {}, onRestart }) {
  const summaryItems = questionnaire.summaryItems ?? [];
  const printRef = useRef(null);
  const measureRef = useRef(new Map());
  const pageContentRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useLayoutEffect(() => {
    let disposed = false;

    const repaginate = () => {
      if (disposed) return;
      const availableHeight = pageContentRef.current?.clientHeight ?? 0;
      if (availableHeight <= 0) return;

      const nextPages = [];
      let currentPage = [];
      let usedHeight = 0;
      const gap = 12;
      const measuredHeights = summaryItems.map((question) =>
        measureRef.current.get(question.id)?.getBoundingClientRect().height ?? 0,
      );

      for (const [index, question] of summaryItems.entries()) {
        const height = measuredHeights[index];
        const nextHeight = currentPage.length === 0 ? height : usedHeight + gap + height;

        if (currentPage.length > 0 && nextHeight > availableHeight) {
          nextPages.push(currentPage);
          currentPage = [];
          usedHeight = 0;
        }

        currentPage.push(question);
        usedHeight += (currentPage.length === 1 ? 0 : gap) + height;
      }

      if (currentPage.length > 0) nextPages.push(currentPage);

      // Greedy pagination can leave a nearly empty final sheet even when a more
      // balanced set of page breaks would fit. Keep the same minimum page count,
      // then choose contiguous breaks that use each Letter sheet more evenly.
      const pageCount = nextPages.length;
      if (pageCount > 1 && summaryItems.length >= pageCount) {
        const prefixHeights = [0];
        for (const height of measuredHeights) prefixHeights.push(prefixHeights.at(-1) + height);

        const totalHeight = prefixHeights.at(-1) + gap * (summaryItems.length - pageCount);
        const targetHeight = totalHeight / pageCount;
        const costs = Array.from({ length: pageCount + 1 }, () => Array(summaryItems.length + 1).fill(Infinity));
        const breaks = Array.from({ length: pageCount + 1 }, () => Array(summaryItems.length + 1).fill(-1));
        costs[0][0] = 0;

        for (let page = 1; page <= pageCount; page += 1) {
          for (let end = page; end <= summaryItems.length - (pageCount - page); end += 1) {
            for (let start = page - 1; start < end; start += 1) {
              if (!Number.isFinite(costs[page - 1][start])) continue;
              const itemCount = end - start;
              const pageHeight = prefixHeights[end] - prefixHeights[start] + gap * (itemCount - 1);
              if (pageHeight > availableHeight) continue;

              const difference = pageHeight - targetHeight;
              const cost = costs[page - 1][start] + difference * difference;
              if (cost < costs[page][end]) {
                costs[page][end] = cost;
                breaks[page][end] = start;
              }
            }
          }
        }

        if (Number.isFinite(costs[pageCount][summaryItems.length])) {
          const balancedPages = [];
          let end = summaryItems.length;
          for (let page = pageCount; page > 0; page -= 1) {
            const start = breaks[page][end];
            balancedPages.unshift(summaryItems.slice(start, end));
            end = start;
          }
          nextPages.splice(0, nextPages.length, ...balancedPages);
        }
      }

      setPages((previous) => {
        const key = (value) => value.map((page) => page.map((item) => item.id).join(',')).join('|');
        return key(previous) === key(nextPages) ? previous : nextPages;
      });
    };

    repaginate();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(repaginate);
    if (pageContentRef.current) observer?.observe(pageContentRef.current);
    measureRef.current.forEach((element) => observer?.observe(element));
    document.fonts?.ready.then(repaginate);
    window.addEventListener('resize', repaginate);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', repaginate);
    };
  }, [summaryItems]);

  const printSummary = () => {
    if (!printRef.current) return;
    document.body.classList.add('print-summary-mode');
    const cleanup = () => {
      document.body.classList.remove('print-summary-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const exportSummaryPdf = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError('');
    try {
      await downloadQuestionnairePdf(summaryItems);
    } catch (error) {
      console.error('Unable to export questionnaire PDF', error);
      setExportError('PDF export failed. You can still use Print to save a copy.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <SectionCard className="print-target summary-document" ref={printRef}>
      <SummaryPages className="summary-pages">
        {pages.map((page, pageIndex) => (
          <SummaryPageFrame className="summary-page-frame" key={pageIndex}>
            <SummaryPage className="summary-page" aria-label={`Summary page ${pageIndex + 1}`}>
              <SummaryGrid className="summary-grid">
                {page.map((question) => (
                  <SummaryCard className="summary-card" key={question.id} id={question.id} $sub={question.isSubQuestion}>
                    <SummaryHeader>
                      <SummaryAnswerBlock>
                        <strong className="summary-question-number">{summaryQuestionNumber(question)}</strong>
                        <span className="summary-question-text">{question.text}</span>
                        <strong className="summary-answer-label">Answer</strong>
                        <span className="summary-answer-value">{summaryAnswer(question)}</span>
                      </SummaryAnswerBlock>
                      <SecondaryButton className="summary-edit" type="button" onClick={() => questionnaire.editQuestion(question.pageIndex, question.id)}>Edit</SecondaryButton>
                    </SummaryHeader>
                  </SummaryCard>
                ))}
              </SummaryGrid>
            </SummaryPage>
          </SummaryPageFrame>
        ))}
      </SummaryPages>
      <SummaryMeasure className="summary-measure" ref={pageContentRef} aria-hidden="true">
        {summaryItems.map((question) => (
          <SummaryCard
            key={question.id}
            $sub={question.isSubQuestion}
            ref={(element) => {
              if (element) measureRef.current.set(question.id, element);
              else measureRef.current.delete(question.id);
            }}
          >
            <SummaryHeader>
              <SummaryAnswerBlock>
                <strong className="summary-question-number">{summaryQuestionNumber(question)}</strong>
                <span className="summary-question-text">{question.text}</span>
                <strong className="summary-answer-label">Answer</strong>
                <span className="summary-answer-value">{summaryAnswer(question)}</span>
              </SummaryAnswerBlock>
              <SecondaryButton className="summary-edit" type="button" tabIndex={-1}>Edit</SecondaryButton>
            </SummaryHeader>
          </SummaryCard>
        ))}
      </SummaryMeasure>
      <ButtonRow className="summary-actions">
        <SecondaryButton type="button" onClick={onRestart}>Restart</SecondaryButton>
        <SecondaryButton type="button" onClick={printSummary}>Print</SecondaryButton>
        <PrimaryButton type="button" onClick={exportSummaryPdf} disabled={isExporting}>
          {isExporting ? 'Preparing PDF…' : 'Export to PDF'}
        </PrimaryButton>
      </ButtonRow>
      {exportError && <p className="summary-export-status" role="status" aria-live="polite">{exportError}</p>}
    </SectionCard>
  );
}

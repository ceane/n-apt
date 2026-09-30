// @ts-nocheck
import { useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';

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
  padding: 24px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  ${({ $sub }) => $sub && 'margin-left: 16px;'}
`;

const SummaryCard = styled.article`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 10px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  gap: 8px;
  ${({ $sub }) => $sub && 'margin-left: 16px;'}
  break-inside: avoid;
  page-break-inside: avoid;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  align-content: start;
  gap: 12px;
`;

const SummaryPages = styled.div`
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, 8.5in);
  justify-content: center;
  align-items: start;
  gap: 24px;
  overflow: auto;
`;

const SummaryPage = styled.section`
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  box-sizing: border-box;
  width: 8.5in;
  height: 11in;
  padding: 0.5in;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.08);
`;

const SummaryMeasure = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  gap: 12px;
  box-sizing: border-box;
  width: calc(7.5in - 2px);
  height: calc(10in - 2px);
  overflow: visible;
  visibility: hidden;
  pointer-events: none;
`;

const SummaryHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
`;

const SummaryAnswerBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  span {
    color: #6b7280;
    font-size: 0.9rem;
  }
`;

const OptionList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  ${({ inline }) => inline && 'flex-direction: row;'}
`;

const Tag = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 16px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
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

const StyledTextArea = styled.textarea`
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  resize: vertical;
`;

export function QuestionInput({ question, answer, onRadioChange, onCheckboxChange, onDateChange, onTextChange }) {
  if (question.type === 'radio') {
    return (
      <OptionList inline>
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
    return <StyledInput type="date" value={answer || ''} onChange={(event) => onDateChange(question.id, event.target.value)} />;
  }

  return <StyledTextArea rows="3" value={answer || ''} onChange={(event) => onTextChange(question.id, event.target.value)} />;
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
          <h3>{question.formattedId} {question.text}</h3>
          <QuestionInput
            question={question}
            answer={questionnaire.answers[question.id]}
            onRadioChange={questionnaire.setAnswer}
            onCheckboxChange={questionnaire.toggleCheckbox}
            onDateChange={questionnaire.setAnswer}
            onTextChange={questionnaire.setAnswer}
          />
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

export function QuestionnaireSummary({ questionnaire = {}, onRestart }) {
  const summaryItems = questionnaire.summaryItems ?? [];
  const printRef = useRef(null);
  const measureRef = useRef(new Map());
  const pageContentRef = useRef(null);
  const [pages, setPages] = useState([]);

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

      for (const question of summaryItems) {
        const height = measureRef.current.get(question.id)?.getBoundingClientRect().height ?? 0;
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

  return (
    <SectionCard className="print-target summary-document" ref={printRef}>
      <SummaryPages className="summary-pages">
        {pages.map((page, pageIndex) => (
          <SummaryPage className="summary-page" key={pageIndex} aria-label={`Summary page ${pageIndex + 1}`}>
            <SummaryGrid className="summary-grid">
              {page.map((question) => (
                <SummaryCard className="summary-card" key={question.id} id={question.id} $sub={question.isSubQuestion}>
                  <SummaryHeader>
                    <SummaryAnswerBlock>
                      <strong>{question.formattedId} {question.text}</strong>
                      <span>
                        {question.answer
                          ? Array.isArray(question.answer)
                            ? question.answer.join(', ')
                            : question.answer
                          : 'No answer provided'}
                      </span>
                    </SummaryAnswerBlock>
                    <SecondaryButton className="summary-edit" type="button" onClick={() => questionnaire.editQuestion(question.pageIndex, question.id)}>Edit</SecondaryButton>
                  </SummaryHeader>
                </SummaryCard>
              ))}
            </SummaryGrid>
          </SummaryPage>
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
                <strong>{question.formattedId} {question.text}</strong>
                <span>
                  {question.answer
                    ? Array.isArray(question.answer)
                      ? question.answer.join(', ')
                      : question.answer
                  : 'No answer provided'}
                </span>
              </SummaryAnswerBlock>
              <SecondaryButton className="summary-edit" type="button" tabIndex={-1}>Edit</SecondaryButton>
            </SummaryHeader>
          </SummaryCard>
        ))}
      </SummaryMeasure>
      <ButtonRow className="summary-actions">
        <SecondaryButton type="button" onClick={onRestart}>Restart</SecondaryButton>
        <PrimaryButton type="button" onClick={printSummary}>Print</PrimaryButton>
      </ButtonRow>
    </SectionCard>
  );
}

// @ts-nocheck
import { useRef } from 'react';
import styled from 'styled-components';

const SectionCard = styled.section`
  padding: 24px;
  border-radius: 24px;
  background: rgba(15, 23, 42, 0.76);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const QuestionCard = styled.article`
  padding: 24px;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.7);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.24);
  ${({ $sub }) => $sub && 'margin-left: 16px;'}
`;

const SummaryCard = styled.article`
  padding: 20px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(30, 41, 59, 0.8);
  display: flex;
  flex-direction: column;
  gap: 12px;
  ${({ $sub }) => $sub && 'margin-left: 16px;'}
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
    color: #94a3b8;
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
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(8, 17, 32, 0.8);
  cursor: pointer;
  input {
    accent-color: #60a5fa;
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
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
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
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.9);
  color: #cbd5e1;
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
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(8, 17, 32, 0.65);
  color: #e5eefb;
`;

const StyledTextArea = styled.textarea`
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(8, 17, 32, 0.65);
  color: #e5eefb;
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
    <SectionCard className="print-target" ref={printRef}>
      {summaryItems.map((question) => (
        <SummaryCard key={question.id} id={question.id} $sub={question.isSubQuestion}>
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
            <SecondaryButton type="button" onClick={() => questionnaire.editQuestion(question.pageIndex, question.id)}>Edit</SecondaryButton>
          </SummaryHeader>
        </SummaryCard>
      ))}
      <ButtonRow>
        <SecondaryButton type="button" onClick={onRestart}>Restart</SecondaryButton>
        <PrimaryButton type="button" onClick={printSummary}>Print</PrimaryButton>
      </ButtonRow>
    </SectionCard>
  );
}

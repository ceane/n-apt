// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import legacyQuestions from '../data/questionnaire/questions.json';
import { pages as legacyPages } from '../data/questionnaire/pages';
import questionnaireMarkdown from '../data/questionnaire/questionnaire.md?raw';
import {
  groupQuestionPages,
  migrateQuestionnaireAnswers,
  parseQuestionnaireMarkdown,
} from '../utils/questionnaireMarkdown';
import {
  pageIndexFromQuestionnairePath,
  questionIdFromQuestionnairePath,
  questionnairePathForPage,
} from '../utils/questionnaireRouting';

const ANSWERS_KEY = 'questionnaire.answers';
const PAGE_KEY = 'questionnaire.currentPage';

function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const questions = parseQuestionnaireMarkdown(questionnaireMarkdown);
const pages = groupQuestionPages(questions).map((page) => page.map((question) => question.id));

function resolveQuestions(pageIndex, pages) {
  const chunk = pages[pageIndex] || [];
  return chunk.map((id) => questions.find((question) => question.id === id)).filter(Boolean);
}

function resolveStoredPage(storedPage, pages) {
  if (storedPage >= legacyPages.length) return pages.length;
  const legacyQuestionId = legacyPages[storedPage]?.[0];
  const legacyQuestion = legacyQuestions.find((question) => question.id === legacyQuestionId);
  if (!legacyQuestion) return 0;
  const question = questions.find((item) => item.id === legacyQuestion.id)
    ?? questions.find((item) => item.text.trim().toLocaleLowerCase() === legacyQuestion.text.trim().toLocaleLowerCase());
  if (!question) return 0;
  const pageIndex = pages.findIndex((page) => page.includes(question.id));
  return pageIndex >= 0 ? pageIndex : 0;
}

export function useQuestionnaire() {
  const workerRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState(() => migrateQuestionnaireAnswers(
    readStorage(ANSWERS_KEY, {}),
    questions,
    legacyQuestions,
  ));
  const [currentPage, setCurrentPage] = useState(() => (
    pageIndexFromQuestionnairePath(location.pathname, pages)
      ?? resolveStoredPage(readStorage(PAGE_KEY, 0), pages)
  ));
  const [scrollToId, setScrollToId] = useState('');
  const [derived, setDerived] = useState({
    totalPages: pages.length,
    isFirstPage: true,
    isLastPage: false,
    currentQuestions: resolveQuestions(0, pages),
    summaryItems: [],
  });

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/questionnaireWorker', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (event) => setDerived(event.data);
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
  }, [answers]);

  useEffect(() => {
    window.localStorage.setItem(PAGE_KEY, JSON.stringify(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const routedPage = pageIndexFromQuestionnairePath(location.pathname, pages);
    if (routedPage !== null) {
      setCurrentPage(routedPage);
      const routedQuestionId = questionIdFromQuestionnairePath(location.pathname, pages);
      setScrollToId(routedQuestionId ?? '');
      return;
    }

    navigate(questionnairePathForPage(currentPage, pages), { replace: true });
  }, [currentPage, location.pathname, navigate]);

  useEffect(() => {
    workerRef.current?.postMessage({ questions, pages, currentPage, answers });
  }, [answers, currentPage]);

  function setAnswer(questionId, value) {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  }

  function toggleCheckbox(questionId, option) {
    const currentValues = answers[questionId] || [];
    setAnswer(
      questionId,
      currentValues.includes(option)
        ? currentValues.filter((entry) => entry !== option)
        : [...currentValues, option],
    );
  }

  function goNext() {
    setScrollToId('');
    const nextPage = Math.min(currentPage + 1, Math.max(0, derived.totalPages - 1));
    navigate(questionnairePathForPage(nextPage, pages));
  }

  function goPrevious() {
    setScrollToId('');
    navigate(questionnairePathForPage(Math.max(currentPage - 1, 0), pages));
  }

  function submit() {
    navigate(questionnairePathForPage(derived.totalPages, pages));
  }

  function backToSummary() {
    navigate(questionnairePathForPage(derived.totalPages, pages));
    setScrollToId(derived.currentQuestions[0]?.id || '');
  }

  function editQuestion(pageIndex, questionId) {
    navigate(questionnairePathForPage(pageIndex, pages, questionId));
    setScrollToId(questionId);
  }

  function resetQuestionnaire() {
    setAnswers({});
    navigate(questionnairePathForPage(0, pages));
    setScrollToId('');
    window.localStorage.removeItem(ANSWERS_KEY);
    window.localStorage.removeItem(PAGE_KEY);
    setDerived({
      totalPages: pages.length,
      isFirstPage: true,
      isLastPage: false,
      currentQuestions: resolveQuestions(0, pages),
      summaryItems: [],
    });
  }

  return {
    currentPage,
    answers,
    scrollToId,
    questions,
    pages,
    totalPages: derived.totalPages,
    isFirstPage: derived.isFirstPage,
    isLastPage: derived.isLastPage,
    currentQuestions: derived.currentQuestions,
    summaryItems: derived.summaryItems,
    setAnswer,
    toggleCheckbox,
    goNext,
    goPrevious,
    submit,
    backToSummary,
    editQuestion,
    setScrollToId,
    resetQuestionnaire,
  };
}

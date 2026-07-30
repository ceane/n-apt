// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import questions from '../data/questionnaire/questions.json';
import { pages } from '../data/questionnaire/pages';

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

function resolveQuestions(pageIndex) {
  const chunk = pages[pageIndex] || [];
  return chunk.map((id) => questions.find((question) => question.id === id)).filter(Boolean);
}

export function useQuestionnaire() {
  const workerRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(() => readStorage(PAGE_KEY, 0));
  const [answers, setAnswers] = useState(() => readStorage(ANSWERS_KEY, {}));
  const [scrollToId, setScrollToId] = useState('');
  const [derived, setDerived] = useState({
    totalPages: pages.length,
    isFirstPage: true,
    isLastPage: false,
    currentQuestions: resolveQuestions(0),
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
    setCurrentPage((previous) => Math.min(previous + 1, derived.totalPages));
  }

  function goPrevious() {
    setScrollToId('');
    setCurrentPage((previous) => Math.max(previous - 1, 0));
  }

  function submit() {
    setCurrentPage(derived.totalPages);
  }

  function backToSummary() {
    setCurrentPage(derived.totalPages);
    setScrollToId(derived.currentQuestions[0]?.id || '');
  }

  function editQuestion(pageIndex, questionId) {
    setCurrentPage(pageIndex);
    setScrollToId(questionId);
  }

  function resetQuestionnaire() {
    setAnswers({});
    setCurrentPage(0);
    setScrollToId('');
    window.localStorage.removeItem(ANSWERS_KEY);
    window.localStorage.removeItem(PAGE_KEY);
    setDerived({
      totalPages: pages.length,
      isFirstPage: true,
      isLastPage: false,
      currentQuestions: resolveQuestions(0),
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

// @ts-nocheck
function formatQuestionId(id) {
  return /^\d+$/.test(id) ? `Q${id}` : `${id.slice(-1)})`;
}

self.onmessage = (event) => {
  const { questions, pages, currentPage, answers } = event.data;
  const totalPages = pages.length;
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const currentQuestions = currentPage < totalPages ? pages[currentPage].map((id) => questionMap.get(id)).filter(Boolean) : [];

  const pageMap = {};
  pages.forEach((pageQuestions, pageIndex) => {
    pageQuestions.forEach((questionId) => {
      pageMap[questionId] = pageIndex;
    });
  });

  const summaryItems = questions.map((question) => ({
    ...question,
    formattedId: formatQuestionId(question.id),
    answer: answers[question.id],
    pageIndex: pageMap[question.id],
    isSubQuestion: /[a-z]/i.test(question.id),
  }));

  self.postMessage({
    totalPages,
    isFirstPage: currentPage === 0,
    isLastPage: currentPage === totalPages - 1,
    currentQuestions: currentQuestions.map((question) => ({
      ...question,
      formattedId: formatQuestionId(question.id),
      isSubQuestion: /[a-z]/i.test(question.id),
    })),
    summaryItems,
  });
};

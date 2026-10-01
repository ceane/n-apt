import { dateAnswerText } from './naturalDate';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_TOP = PAGE_HEIGHT - MARGIN;
const CONTENT_BOTTOM = MARGIN;

function normalizePdfText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*');
}

function splitLongWord(word: string, font: any, size: number, maxWidth: number) {
  const parts = [];
  let part = '';
  for (const character of word) {
    const candidate = part + character;
    if (part && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(part);
      part = character;
    } else {
      part = candidate;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function wrapText(value: unknown, font: any, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of normalizePdfText(value).split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (line) lines.push(line);
        const parts = splitLongWord(word, font, size, maxWidth);
        lines.push(...parts.slice(0, -1));
        line = parts[parts.length - 1] ?? '';
        continue;
      }

      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

export async function downloadQuestionnairePdf(items: any[]) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Questionnaire Responses');
  pdf.setSubject('Questionnaire response summary');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.16, 0.22);
  const muted = rgb(0.35, 0.39, 0.45);
  const answerLabelMuted = rgb(0.77, 0.79, 0.82);
  const questionSize = 10.5;
  const questionNumberSize = 8.5;
  const answerSize = 10;
  const answerLabelSize = 8.5;
  const questionLeading = 13;
  const questionNumberLeading = 11;
  const answerLeading = 12.5;
  const answerLabelLeading = 11;
  let page: any;
  let cursorY = 0;

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = CONTENT_TOP;
    return page;
  };

  addPage();
  page.drawText('Questionnaire Responses', {
    x: MARGIN,
    y: cursorY - 17,
    size: 15,
    font: bold,
    color: ink,
  });
  cursorY -= 30;

  for (const question of items) {
    const indentation = question.isSubQuestion ? 18 : 0;
    const x = MARGIN + indentation;
    const maxWidth = CONTENT_WIDTH - indentation;
    const questionNumber = question.isSubQuestion
      ? String(question.formattedId ?? '')
      : String(question.formattedId ?? '').replace(/^Q(?=\d)/, 'Question ');
    const questionNumberLines = wrapText(questionNumber, bold, questionNumberSize, maxWidth);
    const questionLines = wrapText(question.text, bold, questionSize, maxWidth);
    const hasAnswer = question.answer !== undefined
      && question.answer !== null
      && !(Array.isArray(question.answer) && question.answer.length === 0)
      && question.answer !== '';
    const answer = hasAnswer ? dateAnswerText(question.answer) : 'No answer provided';
    const answerLines = wrapText(answer, regular, answerSize, maxWidth);
    const topPadding = 4;
    const numberTextGap = 1;
    const answerSectionGap = 4;
    const answerLabelGap = 1;
    const bottomPadding = 5;
    const rowHeight = topPadding
      + questionNumberLines.length * questionNumberLeading
      + numberTextGap
      + questionLines.length * questionLeading
      + answerSectionGap
      + answerLabelLeading
      + answerLabelGap
      + answerLines.length * answerLeading
      + bottomPadding;

    if (cursorY - rowHeight < CONTENT_BOTTOM) {
      addPage();
    }

    cursorY -= topPadding;
    for (const line of questionNumberLines) {
      if (cursorY - questionNumberLeading < CONTENT_BOTTOM) addPage();
      cursorY -= questionNumberLeading;
      if (line) page.drawText(line, { x, y: cursorY + 2, size: questionNumberSize, font: bold, color: muted });
    }
    cursorY -= numberTextGap;
    for (const line of questionLines) {
      if (cursorY - questionLeading < CONTENT_BOTTOM) addPage();
      cursorY -= questionLeading;
      if (line) page.drawText(line, { x, y: cursorY + 2, size: questionSize, font: bold, color: ink });
    }

    cursorY -= answerSectionGap;
    cursorY -= answerLabelLeading;
    page.drawText('Answer', {
      x,
      y: cursorY + 2,
      size: answerLabelSize,
      font: bold,
      color: answerLabelMuted,
    });
    cursorY -= answerLabelGap;
    for (const line of answerLines) {
      if (cursorY - answerLeading < CONTENT_BOTTOM) {
        addPage();
        const continuationLines = wrapText(`${questionNumber} (continued)`, bold, questionNumberSize, maxWidth);
        cursorY -= topPadding;
        for (const continuationLine of continuationLines) {
          if (cursorY - questionNumberLeading < CONTENT_BOTTOM) addPage();
          cursorY -= questionNumberLeading;
          if (continuationLine) page.drawText(continuationLine, { x, y: cursorY + 2, size: questionNumberSize, font: bold, color: muted });
        }
        for (const questionLine of questionLines) {
          if (cursorY - questionLeading < CONTENT_BOTTOM) addPage();
          cursorY -= questionLeading;
          if (questionLine) page.drawText(questionLine, { x, y: cursorY + 2, size: questionSize, font: bold, color: ink });
        }
        cursorY -= answerSectionGap + answerLabelLeading;
        page.drawText('Answer', { x, y: cursorY + 2, size: answerLabelSize, font: bold, color: answerLabelMuted });
        cursorY -= answerLabelGap;
      }
      cursorY -= answerLeading;
      if (line) page.drawText(line, { x, y: cursorY + 2, size: answerSize, font: regular, color: ink });
    }
    if (cursorY - bottomPadding >= CONTENT_BOTTOM) cursorY -= bottomPadding;
  }

  const pageCount = pdf.getPageCount();
  pdf.getPages().forEach((pdfPage, index) => {
    pdfPage.drawText(`Page ${index + 1} of ${pageCount}`, {
      x: MARGIN,
      y: CONTENT_BOTTOM - 12,
      size: 8,
      font: regular,
      color: muted,
    });
  });

  const pdfBytes = await pdf.save();
  const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(pdfBuffer).set(pdfBytes);
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const localDate = new Date();
  const date = [localDate.getFullYear(), String(localDate.getMonth() + 1).padStart(2, '0'), String(localDate.getDate()).padStart(2, '0')].join('-');
  const link = document.createElement('a');
  link.href = url;
  link.download = `questionnaire-responses-${date}.pdf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import * as chrono from 'chrono-node';

export const NATURAL_DATE_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ALIASES = NATURAL_DATE_MONTHS.flatMap((month) => [month, month.slice(0, 3), ...(month === 'september' ? ['sept'] : [])]);
const MONTH_PATTERN = MONTH_ALIASES.map((month) => `${month}(?:\\.)?`).join('|');
const MONTH_ONLY_PATTERN = new RegExp(`^(?:${MONTH_PATTERN})$`, 'i');
const MODIFIERS = ['early', 'mid', 'middle', 'late', 'around', 'about'];
const SEASON_NAMES = ['spring', 'summer', 'fall', 'autumn', 'winter'];
const SEASONS: Record<string, { startMonth: number; startYearOffset: number; endMonth: number; endYearOffset: number }> = {
  spring: { startMonth: 3, startYearOffset: 0, endMonth: 5, endYearOffset: 0 },
  summer: { startMonth: 6, startYearOffset: 0, endMonth: 8, endYearOffset: 0 },
  fall: { startMonth: 9, startYearOffset: 0, endMonth: 11, endYearOffset: 0 },
  autumn: { startMonth: 9, startYearOffset: 0, endMonth: 11, endYearOffset: 0 },
  winter: { startMonth: 12, startYearOffset: 0, endMonth: 2, endYearOffset: 1 },
};

export function isNaturalDateMonth(value: string) {
  return MONTH_ONLY_PATTERN.test(value.trim());
}

export function monthAutocompleteSuggestions(value: string) {
  const parts = value.trim().split(/\s+/);
  if (!parts[0] || parts.length > 2) return [];
  const capitalize = (word: string) => `${word[0].toUpperCase()}${word.slice(1)}`;
  const targets = [...NATURAL_DATE_MONTHS, ...SEASON_NAMES];

  if (parts.length === 1) {
    const prefix = parts[0].toLowerCase();
    return [...MODIFIERS, ...targets]
      .filter((word) => word.startsWith(prefix) && word !== prefix)
      .map(capitalize);
  }

  const modifierPrefix = parts[0].toLowerCase();
  const targetPrefix = parts[1].toLowerCase();
  const matchingModifiers = MODIFIERS.filter((modifier) => modifier.startsWith(modifierPrefix));
  const matchingTargets = targets.filter((target) => target.startsWith(targetPrefix));
  return matchingModifiers.flatMap((modifier) => matchingTargets
    .filter((target) => `${modifier} ${target}`.toLowerCase() !== value.trim().toLowerCase())
    .map((target) => `${capitalize(modifier)} ${capitalize(target)}`));
}

export type NaturalDateAnswer = {
  kind: 'date-range';
  raw: string;
  start: string;
  end: string;
  precision: 'exact' | 'early' | 'middle' | 'late' | 'approximate-month' | 'season' | 'season-partial';
  display: string;
};

function toIsoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function formatRange(start: string, end: string) {
  if (start === end) return formatDate(start);
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);

  if (sameMonth) {
    const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(startDate);
    return `${month} ${startDate.getUTCDate()}–${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`;
  }
  if (sameYear) {
    const monthDay = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
    const year = endDate.getUTCFullYear();
    return `${monthDay.format(startDate)}–${monthDay.format(endDate)}, ${year}`;
  }
  return `${formatDate(start)}–${formatDate(end)}`;
}

function makeAnswer(raw: string, year: number, month: number, firstDay: number, lastDay: number, precision: NaturalDateAnswer['precision']): NaturalDateAnswer {
  const start = toIsoDate(year, month, firstDay);
  const end = toIsoDate(year, month, lastDay);
  return { kind: 'date-range', raw, start, end, precision, display: formatRange(start, end) };
}

function isoFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function makeSeasonAnswer(raw: string, year: number, seasonName: string, modifier: string) {
  const season = SEASONS[seasonName];
  const startYear = year + season.startYearOffset;
  const endYear = year + season.endYearOffset;
  const startTimestamp = Date.UTC(startYear, season.startMonth - 1, 1);
  const endDay = new Date(Date.UTC(endYear, season.endMonth, 0)).getUTCDate();
  const endTimestamp = Date.UTC(endYear, season.endMonth - 1, endDay);
  let start = isoFromTimestamp(startTimestamp);
  let end = isoFromTimestamp(endTimestamp);
  let precision: NaturalDateAnswer['precision'] = 'season';

  if (['early', 'mid', 'middle', 'late'].includes(modifier)) {
    const totalDays = Math.floor((endTimestamp - startTimestamp) / 86_400_000) + 1;
    const firstThirdEnd = Math.floor(totalDays / 3);
    const secondThirdEnd = Math.floor((totalDays * 2) / 3);
    const dayRange = modifier === 'early'
      ? [0, firstThirdEnd - 1]
      : modifier === 'mid' || modifier === 'middle'
        ? [firstThirdEnd, secondThirdEnd - 1]
        : [secondThirdEnd, totalDays - 1];
    start = isoFromTimestamp(startTimestamp + dayRange[0] * 86_400_000);
    end = isoFromTimestamp(startTimestamp + dayRange[1] * 86_400_000);
    precision = 'season-partial';
  }

  return {
    kind: 'date-range' as const,
    raw,
    start,
    end,
    precision,
    display: formatRange(start, end),
  };
}

export function parseNaturalDate(value: string): NaturalDateAnswer | null {
  const raw = value.trim();
  if (!raw) return null;

  const seasonMatch = raw.match(/^(?:(early|mid|middle|late|around|about)\s+)?(spring|summer|fall|autumn|winter)\s+(\d{4})$/i);
  if (seasonMatch) {
    const [, modifier = '', seasonName, yearText] = seasonMatch;
    const year = Number(yearText);
    if (year < 1000) return null;
    return makeSeasonAnswer(raw, year, seasonName.toLowerCase(), modifier.toLowerCase());
  }

  const monthMatch = raw.match(new RegExp(`^(?:(early|mid|middle|late|around|about)\\s+)?(${MONTH_PATTERN})\\s+(\\d{4})$`, 'i'));
  if (monthMatch) {
    const [, phrase = '', monthText, yearText] = monthMatch;
    const normalizedMonth = monthText.toLowerCase().replace(/\.$/, '');
    const monthName = NATURAL_DATE_MONTHS.find((entry) => entry.startsWith(normalizedMonth));
    const month = MONTH_ALIASES.includes(normalizedMonth) && monthName
      ? NATURAL_DATE_MONTHS.indexOf(monthName) + 1
      : 0;
    const year = Number(yearText);
    if (year < 1000 || month < 1) return null;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstThirdEnd = Math.floor(daysInMonth / 3);
    const secondThirdEnd = Math.floor((daysInMonth * 2) / 3);
    const precision = phrase.toLowerCase();

    if (precision === 'early') return makeAnswer(raw, year, month, 1, firstThirdEnd, 'early');
    if (precision === 'mid' || precision === 'middle') return makeAnswer(raw, year, month, firstThirdEnd + 1, secondThirdEnd, 'middle');
    if (precision === 'late') return makeAnswer(raw, year, month, secondThirdEnd + 1, daysInMonth, 'late');
    return makeAnswer(raw, year, month, 1, daysInMonth, 'approximate-month');
  }

  const results = chrono.strict.parse(raw);
  if (results.length !== 1 || results[0].index !== 0 || results[0].text.trim().toLowerCase() !== raw.toLowerCase()) return null;

  const parsed = results[0].start;
  if (!parsed.isCertain('year') || !parsed.isCertain('month') || !parsed.isCertain('day')) return null;
  const year = parsed.get('year');
  const month = parsed.get('month');
  const day = parsed.get('day');
  if (!year || !month || !day) return null;
  return makeAnswer(raw, year, month, day, day, 'exact');
}

export function dateAnswerText(answer: unknown) {
  if (answer && typeof answer === 'object' && 'kind' in answer && answer.kind === 'date-range') {
    return String((answer as NaturalDateAnswer).display);
  }
  return Array.isArray(answer) ? answer.join(', ') : String(answer ?? '');
}

export function dateAnswerInputValue(answer: unknown) {
  if (answer && typeof answer === 'object' && 'kind' in answer && answer.kind === 'date-range') {
    return String((answer as NaturalDateAnswer).raw);
  }
  return typeof answer === 'string' ? answer : '';
}

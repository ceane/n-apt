import React from 'react';
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { dateAnswerText, isNaturalDateMonth, monthAutocompleteSuggestions, parseNaturalDate } from '../../src/app-legal/utils/naturalDate';
import { QuestionInput } from '../../src/app-legal/components/QuestionnairePanels';

describe('natural questionnaire dates', () => {
  test('does not leak styling-only inline props to radio option markup', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <QuestionInput
        question={{ id: 'frequency', type: 'radio', options: ['Daily', 'Weekly'] }}
        answer=""
      />,
    );

    try {
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('recognizes abbreviated late-month input as the final third of the month', () => {
    expect(parseNaturalDate('Late Sept 2018')).toMatchObject({
      start: '2018-09-21',
      end: '2018-09-30',
      precision: 'late',
      display: 'September 21–30, 2018',
    });
  });

  test('recognizes a month-only abbreviation for autocomplete without inventing a year', () => {
    expect(isNaturalDateMonth('Sept')).toBe(true);
    expect(parseNaturalDate('Sept')).toBeNull();
  });

  test('maps an approximate month to the full month', () => {
    const answer = parseNaturalDate('around July 2026');
    expect(answer).toMatchObject({ start: '2026-07-01', end: '2026-07-31', precision: 'approximate-month' });
    expect(dateAnswerText(answer)).toBe('July 1–31, 2026');
  });

  test('recognizes a fully specified exact date', () => {
    expect(parseNaturalDate('October 14, 2020')).toMatchObject({
      start: '2020-10-14',
      end: '2020-10-14',
      precision: 'exact',
    });
  });

  test('does not infer a year from an incomplete month phrase', () => {
    expect(parseNaturalDate('Late September')).toBeNull();
  });

  test('suggests qualifiers and completes a month after a qualifier', () => {
    expect(monthAutocompleteSuggestions('ea')).toContain('Early');
    expect(monthAutocompleteSuggestions('mid se')).toEqual(['Mid September', 'Middle September']);
    expect(monthAutocompleteSuggestions('early f')).toContain('Early Fall');
    expect(monthAutocompleteSuggestions('f')).toContain('Fall');
  });

  test('parses a fall season using Northern Hemisphere meteorological months', () => {
    expect(parseNaturalDate('Fall 2018')).toMatchObject({
      start: '2018-09-01',
      end: '2018-11-30',
      precision: 'season',
      display: 'September 1–November 30, 2018',
    });
    expect(parseNaturalDate('Autumn 2018')?.start).toBe('2018-09-01');
  });

  test('parses winter as a season spanning December into the following year', () => {
    expect(parseNaturalDate('Winter 2018')).toMatchObject({
      start: '2018-12-01',
      end: '2019-02-28',
      precision: 'season',
    });
  });

  test('supports early and mid season ranges', () => {
    expect(parseNaturalDate('Early Fall 2018')).toMatchObject({
      start: '2018-09-01',
      end: '2018-09-30',
      precision: 'season-partial',
    });
    expect(parseNaturalDate('Mid Winter 2018')).toMatchObject({
      start: '2018-12-31',
      end: '2019-01-29',
      precision: 'season-partial',
    });
  });

  test('offers month autocomplete and does not report an error while typing', () => {
    const onDateChange = jest.fn();
    function Harness() {
      const [answer, setAnswer] = React.useState('');
      return <QuestionInput question={{ id: '2', type: 'date' }} answer={answer} onDateChange={(_, next) => { onDateChange('2', next); setAnswer(next); }} />;
    }
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Date or approximate date' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Sept' } });
    expect(screen.getByRole('option', { name: 'September' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not identify that date/)).toBeNull();

    const autocompleteTab = createEvent.keyDown(input, { key: 'Tab' });
    fireEvent(input, autocompleteTab);
    expect(autocompleteTab.defaultPrevented).toBe(true);
    expect(onDateChange).toHaveBeenLastCalledWith('2', 'September');
    fireEvent.blur(input);
    expect(screen.getByText(/Add a year to this month/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Late Sept 2018' } });
    expect(onDateChange).toHaveBeenLastCalledWith('2', expect.objectContaining({
      start: '2018-09-21',
      end: '2018-09-30',
    }));
  });

  test('Tab cycles through multiple month suggestions and Enter selects the active one', () => {
    const onDateChange = jest.fn();
    function Harness() {
      const [answer, setAnswer] = React.useState('');
      return <QuestionInput question={{ id: '2', type: 'date' }} answer={answer} onDateChange={(_, next) => { onDateChange('2', next); setAnswer(next); }} />;
    }
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Date or approximate date' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'J' } });
    expect(screen.getAllByRole('option')).toHaveLength(3);

    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDateChange).toHaveBeenLastCalledWith('2', 'June');
  });

  test('waits 15 seconds of inactivity before flagging an unresolved date', () => {
    jest.useFakeTimers();
    function Harness() {
      const [answer, setAnswer] = React.useState('');
      return <QuestionInput question={{ id: '2', type: 'date' }} answer={answer} onDateChange={(_, next) => setAnswer(next)} />;
    }
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Date or approximate date' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'late someday 2018' } });
    act(() => jest.advanceTimersByTime(14_999));
    expect(screen.queryByText(/Could not identify that date/)).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByText(/Could not identify that date/)).toBeInTheDocument();
    jest.useRealTimers();
  });
});

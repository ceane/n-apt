import React, { useEffect, useState, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { motion, animate } from 'framer-motion';

const START_DATE = new Date('2018-09-30T00:00:00Z');
const ESCALATION_DATE = new Date('2023-01-01T00:00:00Z');

// Default fallback rates
const DEFAULT_RATE_MBS = 3.47;
const DEFAULT_RATE_DAY_GB = (DEFAULT_RATE_MBS * 86400) / 1000;

const Container = styled.div`
  --ds-bg-start: rgba(40, 55, 128, 0.4);
  --ds-bg-end: rgba(20, 28, 64, 0.6);
  --ds-border: rgba(158, 174, 255, 0.15);
  --ds-accent: rgba(158, 174, 255, 0.5);
  --ds-text-primary: #f3f6ff;
  --ds-text-secondary: rgba(172, 186, 255, 0.7);
  --ds-text-unit: rgba(172, 186, 255, 0.5);
  --ds-text-dim: rgba(172, 186, 255, 0.4);

  display: flex;
  flex-direction: column;
  gap: 3rem;
  position: relative;
  overflow: hidden;
`;

const TopRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 2rem;
`;

const DataContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 2rem;
  position: relative;
`;

const SectionLabel = styled.div`
  font-family: "KaTeX_Main", serif;
  font-size: 0.65rem;
  letter-spacing: 0.25em;
  color: var(--ds-text-dim);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: -2rem;
  z-index: 1;
`;

const StatBox = styled(motion.div)`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.small`
  font-family: "KaTeX_Main", serif;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--ds-text-secondary);
  font-weight: 600;
`;

const Value = styled.div`
  font-family: "KaTeX_Main", serif;
  font-size: 2.3rem;
  font-weight: 400;
  color: var(--ds-text-primary);
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  line-height: 1;

  span.unit {
    font-family: "KaTeX_Main", serif;
    font-size: 1.6rem;
    color: var(--ds-text-unit);
    font-style: italic;
  }
`;

const SubValue = styled.small`
  font-family: "KaTeX_Main", serif;
  font-size: 1rem;
  color: var(--ds-text-dim);
  margin-top: -0.2rem;
  font-style: italic;
  letter-spacing: 0.02em;
  line-height: 1.3;
`;

const CostContainer = styled(DataContainer)`
  margin-top: 0;
`;

const DigitContainer = styled.span`
  display: inline-block;
  position: relative;
  overflow: hidden;
  vertical-align: bottom;
  will-change: transform;
`;

const PlaceholderDigit = styled.span`
  visibility: hidden;
  display: inline-block;
  padding: 0.15em 0;
`;

const DigitList = styled(motion.span)`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  will-change: transform;
`;

const SingleDigit = styled.span`
  display: inline-block;
  padding: 0.15em 0;
  flex-shrink: 0;
  text-align: center;
`;

const CounterWrapper = styled.span`
  display: inline-flex;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
`;

const RollingCounter: React.FC<{ value: string | number }> = ({ value }) => {
  const str = String(value);

  return (
    <CounterWrapper>
      {str.split('').map((char, idx) => {
        if (char >= '0' && char <= '9') {
          const digit = parseInt(char, 10);
          return (
            <DigitContainer key={idx}>
              <PlaceholderDigit>{digit}</PlaceholderDigit>
              <DigitList
                initial={{ y: '0%' }}
                animate={{ y: `-${digit * 10}%` }}
                transition={{
                  duration: 2,
                  delay: 0.1, // brief delay to start rolling after fade-in starts
                  ease: [0.1, 1.0, 0.1, 1.0], // cubic-bezier(0.1, 1, 0.1, 1)
                }}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <SingleDigit key={d}>{d}</SingleDigit>
                ))}
              </DigitList>
            </DigitContainer>
          );
        }
        return <span key={idx}>{char}</span>;
      })}
    </CounterWrapper>
  );
};

const formatNumber = (num: number) => {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(num);
};

const formatCurrency = (val: number) => {
  if (val >= 1000000) {
    return `$${(val / 1000000).toFixed(2)}M`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
};

// Helper to convert units to base MB or GB
const parseValueWithUnit = (text: string, type: 'rate' | 'total'): number | null => {
  const cleanText = text.replace(/[*~]/g, '').trim();
  const match = cleanText.match(/([\d.]+)\s*([A-Za-z/]+)/);
  if (!match) return null;

  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (type === 'rate') {
    if (unit.includes('kb/s')) return val / 1000;
    if (unit.includes('mb/s')) return val;
    if (unit.includes('gb/s')) return val * 1000;
  } else {
    if (unit === 'mb') return val / 1000;
    if (unit === 'gb') return val;
    if (unit === 'tb') return val * 1000;
    if (unit === 'pb') return val * 1000000;
  }
  return val;
};

export const DaysSince: React.FC = () => {
  const [now, setNow] = useState(new Date());
  const [rateMbs, setRateMbs] = useState(DEFAULT_RATE_MBS);
  const [rateDayGb, setRateDayGb] = useState(DEFAULT_RATE_DAY_GB);

  // Derive rates from the markdown table by parsing text directly
  useEffect(() => {
    const findRates = () => {
      const container = document.querySelector('[data-data-estimate="network"]');
      if (!container) return;

      const table = container.querySelector('table');
      if (!table) return;

      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3 && row.textContent?.toLowerCase().includes('total')) {
          // Find the cell with MB/s
          let foundMbs = null;
          let foundDayGb = null;

          cells.forEach((cell) => {
            const text = cell.textContent || '';
            if (text.toLowerCase().includes('mb/s')) {
              foundMbs = parseValueWithUnit(text, 'rate');
            } else if (text.toLowerCase().includes('gb') || text.toLowerCase().includes('tb')) {
              // The last cell is usually the 24h total
              foundDayGb = parseValueWithUnit(text, 'total');
            }
          });

          if (foundMbs !== null) setRateMbs(foundMbs);
          if (foundDayGb !== null) setRateDayGb(foundDayGb);
        }
      });
    };

    findRates();
    const timeout = setTimeout(findRates, 1000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const totalMs = now.getTime() - START_DATE.getTime();
    const escalationMs = now.getTime() - ESCALATION_DATE.getTime();

    const totalSeconds = totalMs / 1000;
    const totalHours = totalSeconds / 3600;
    const totalDays = totalSeconds / 86400;

    const escalationHours = escalationMs / 3600000;

    return {
      totalHours,
      escalationHours,
      totalDays,
    };
  }, [now]);

  const data = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalMB = totalSeconds * rateMbs;

    if (totalMB >= Math.pow(1000, 4)) {
      return { val: (totalMB / Math.pow(1000, 4)).toFixed(3), unit: 'EB' };
    }
    if (totalMB >= Math.pow(1000, 3)) {
      return { val: (totalMB / Math.pow(1000, 3)).toFixed(3), unit: 'PB' };
    }
    if (totalMB >= Math.pow(1000, 2)) {
      return { val: (totalMB / Math.pow(1000, 2)).toFixed(2), unit: 'TB' };
    }
    return { val: (totalMB / 1000).toFixed(2), unit: 'GB' };
  }, [now, rateMbs]);

  const comparisonTypes = useMemo(() => {
    const options = [
      { label: '4K movies', sizeMB: 25 * 1000 },
      { label: 'HD movies', sizeMB: 5 * 1000 },
      { label: 'TikTok videos', sizeMB: 15 },
      { label: 'Spotify songs', sizeMB: 5 },
      { label: 'iPhone-shot photos', sizeMB: 3 },
      { label: 'tweets', sizeMB: 0.003 },
      { label: 'emails', sizeMB: 0.075 },
      { label: 'Wikipedia pages', sizeMB: 0.15 },
    ];

    const shuffled = [...options].sort(() => Math.random() - 0.5);
    return {
      total: shuffled[0],
      daily: shuffled[1],
    };
  }, []);

  const formatComparisonCount = (count: number) => {
    if (count >= 1e15) return `${(count / 1e15).toFixed(1)} quadrillion`;
    if (count >= 1e12) return `${(count / 1e12).toFixed(1)} trillion`;
    if (count >= 1e9) return `${(count / 1e9).toFixed(1)} billion`;
    if (count >= 1e6) return `${(count / 1e6).toFixed(1)} million`;
    if (count >= 1000) return new Intl.NumberFormat().format(Math.round(count));
    return count.toFixed(0);
  };

  const totalComparisonText = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalMB = totalSeconds * rateMbs;
    const count = totalMB / comparisonTypes.total.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.total.label}`;
  }, [now, rateMbs, comparisonTypes.total]);

  const dailyComparisonText = useMemo(() => {
    const dailyMB = rateMbs * 86400;
    const count = dailyMB / comparisonTypes.daily.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.daily.label}`;
  }, [rateMbs, comparisonTypes.daily]);

  const approxGB = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGB = (totalSeconds * rateMbs) / 1000;
    if (totalGB < 1000) return null;

    if (totalGB >= 1000000) {
      return `or approximately ${(totalGB / 1000000).toFixed(1)} million GB`;
    }
    return `or approximately ${new Intl.NumberFormat().format(Math.round(totalGB))} GB`;
  }, [now, rateMbs]);

  const costs = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGB = (totalSeconds * rateMbs) / 1000;
    const dailyGB = (rateMbs * 86400) / 1000;

    return {
      total: `${formatCurrency(totalGB * 0.07)} – ${formatCurrency(totalGB * 0.12)}`,
      daily: `${formatCurrency(dailyGB * 0.07)} – ${formatCurrency(dailyGB * 0.12)}`,
    };
  }, [now, rateMbs]);

  return (
    <Container>
      <TopRow>
        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Label>Hours Total</Label>
          <Value>
            <RollingCounter value={formatNumber(stats.totalHours)} />
            <span className="unit">hrs</span>
          </Value>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Label>Since Escalation</Label>
          <Value>
            <RollingCounter value={formatNumber(stats.escalationHours)} />
            <span className="unit">hrs</span>
          </Value>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Label>Days Total</Label>
          <Value>
            <RollingCounter value={formatNumber(stats.totalDays)} />
            <span className="unit">days</span>
          </Value>
        </StatBox>
      </TopRow>

      <DataContainer>
        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Label>Data Intercepted Total</Label>
          <Value>
            <RollingCounter value={data.val} />
            <span className="unit">{data.unit}</span>
          </Value>
          {approxGB && <SubValue>{approxGB}</SubValue>}
          <SubValue>{totalComparisonText}</SubValue>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Label>Data Intercepted in 24HRS</Label>
          <Value>
            <RollingCounter value={Math.round(rateDayGb)} />
            <span className="unit">GB</span>
          </Value>
          <SubValue>{dailyComparisonText}</SubValue>
        </StatBox>
      </DataContainer>

      <CostContainer>
        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Label>Data total Cost (to present)</Label>
          <Value>
            <RollingCounter value={costs.total} />
          </Value>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <Label>Data cost per Day</Label>
          <Value>
            <RollingCounter value={costs.daily} />
            <span className="unit">/day</span>
          </Value>
        </StatBox>
      </CostContainer>

      <SectionLabel style={{ marginTop: '-1rem', marginBottom: '0' }}>
        Estimated Network Ingress/Egress Cost based on market rates
      </SectionLabel>
    </Container>
  );
};
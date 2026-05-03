import React, { useEffect, useState, useMemo } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';

const START_DATE = new Date('2018-09-30T00:00:00Z');
const ESCALATION_DATE = new Date('2023-01-01T00:00:00Z');
const DATA_RATE_MB_PER_SEC = 27.76;

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
    font-size: 1.1rem;
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


const formatNumber = (num: number) => {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(num);
};



export const DaysSince: React.FC = () => {
  const [now, setNow] = useState(new Date());

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
    const totalMB = totalSeconds * DATA_RATE_MB_PER_SEC;

    // 1024 MB = 1 GB
    // 1024^2 MB = 1 TB
    // 1024^3 MB = 1 PB
    // 1024^4 MB = 1 EB

    if (totalMB >= Math.pow(1024, 4)) {
      return { val: (totalMB / Math.pow(1024, 4)).toFixed(3), unit: 'EB' };
    }
    if (totalMB >= Math.pow(1024, 3)) {
      return { val: (totalMB / Math.pow(1024, 3)).toFixed(3), unit: 'PB' };
    }
    if (totalMB >= Math.pow(1024, 2)) {
      return { val: (totalMB / Math.pow(1024, 2)).toFixed(2), unit: 'TB' };
    }
    return { val: (totalMB / 1024).toFixed(2), unit: 'GB' };
  }, [now]);

  const comparisonTypes = useMemo(() => {
    const options = [
      { label: '4K movies', sizeMB: 25 * 1024 },
      { label: 'HD movies', sizeMB: 5 * 1024 },
      { label: 'TikTok videos', sizeMB: 15 },
      { label: 'Spotify songs', sizeMB: 5 },
      { label: 'iPhone-shot photos', sizeMB: 3 },
      { label: 'tweets', sizeMB: 3 / 1024 },
      { label: 'emails', sizeMB: 75 / 1024 },
      { label: 'Wikipedia pages', sizeMB: 150 / 1024 },
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
    const totalMB = totalSeconds * DATA_RATE_MB_PER_SEC;
    const count = totalMB / comparisonTypes.total.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.total.label}`;
  }, [now, comparisonTypes.total]);

  const dailyComparisonText = useMemo(() => {
    const dailyMB = 2.4 * 1024 * 1024; // 2.4 TB in MB
    const count = dailyMB / comparisonTypes.daily.sizeMB;
    return `or ${formatComparisonCount(count)} ${comparisonTypes.daily.label}`;
  }, [comparisonTypes.daily]);

  const approxGB = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGB = (totalSeconds * DATA_RATE_MB_PER_SEC) / 1024;
    if (totalGB < 1024) return null;

    if (totalGB >= 1000000) {
      return `or approximately ${(totalGB / 1000000).toFixed(1)} million GB`;
    }
    return `or approximately ${new Intl.NumberFormat().format(Math.round(totalGB))} GB`;
  }, [now]);

  const costs = useMemo(() => {
    const totalSeconds = (now.getTime() - START_DATE.getTime()) / 1000;
    const totalGB = (totalSeconds * DATA_RATE_MB_PER_SEC) / 1024;
    const dailyGB = 2.4 * 1024; // 2.4 TB in GB

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

    return {
      total: `${formatCurrency(totalGB * 0.07)} – ${formatCurrency(totalGB * 0.12)}`,
      daily: `${formatCurrency(dailyGB * 0.07)} – ${formatCurrency(dailyGB * 0.12)}`,
    };
  }, [now]);

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
            {formatNumber(stats.totalHours)}
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
            {formatNumber(stats.escalationHours)}
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
            {formatNumber(stats.totalDays)}
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
            {data.val}
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
            2.4
            <span className="unit">TB</span>
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
            {costs.total}
          </Value>
        </StatBox>

        <StatBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <Label>Data cost per Day</Label>
          <Value>
            {costs.daily}
            <span className="unit">/day</span>
          </Value>
        </StatBox>
      </CostContainer>
      <SectionLabel style={{ marginTop: '-1rem', marginBottom: '0' }}>
        Estimated Network Ingress/Egress Cost
      </SectionLabel>
    </Container>
  );
};
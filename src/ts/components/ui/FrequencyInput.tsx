import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";

const InputContainer = styled.div`
  display: flex;
  gap: 4px;
  width: 100%;
`;

const StyledInput = styled.input`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 6px 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  font-family: ${({ theme }) => theme.typography.mono};
  flex: 1;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary}22;
  }

  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`;

const UnitSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface || "rgba(255, 255, 255, 0.05)"};
  border: 1px solid ${({ theme }) => theme.colors.border || "rgba(255, 255, 255, 0.1)"};
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.mono || "monospace"};
  color: ${({ theme }) => theme.colors.primary};
  min-width: 65px;
  cursor: pointer;
  appearance: none;
  text-align: center;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.border}44;
  }

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  option {
    background: ${({ theme }) => theme.colors.surface || "#1a1a1a"};
    color: ${({ theme }) => theme.colors.textPrimary || "#ffffff"};
  }
`;

interface FrequencyInputProps {
  valueHz: number;
  onChangeHz: (hz: number) => void;
  minHz?: number;
  maxHz?: number;
  label?: string;
}

function clampFrequencyHz(hz: number, minHz: number, maxHz: number): number {
  const safeMin = Number.isFinite(minHz) ? minHz : 0;
  const safeMax = Number.isFinite(maxHz) ? maxHz : Number.MAX_VALUE;
  const lo = Math.min(safeMin, safeMax);
  const hi = Math.max(safeMin, safeMax);
  if (!Number.isFinite(hz)) return lo;
  return Math.max(lo, Math.min(hz, hi));
}

export const FrequencyInput: React.FC<FrequencyInputProps> = ({
  valueHz,
  onChangeHz,
  minHz = 0,
  maxHz = 30_000_000_000,
}) => {
  const [displayValue, setDisplayValue] = useState<string>("0");
  const [displayUnit, setDisplayUnit] = useState<string>("Hz");
  
  // Use a ref to track the "current" Hz value for continuous keyboard tuning
  // even if parent renders are slow.
  const hzRef = useRef(valueHz);
  const onChangeRef = useRef(onChangeHz);
  onChangeRef.current = onChangeHz;
  const isFocusedRef = useRef(false);

  const getOptimalUnit = (hz: number) => {
    const absHz = Math.abs(hz);
    if (absHz >= 1_000_000_000) return { val: hz / 1_000_000_000, unit: "GHz" };
    if (absHz >= 1_000_000) return { val: hz / 1_000_000, unit: "MHz" };
    if (absHz >= 1_000) return { val: hz / 1_000, unit: "kHz" };
    return { val: hz, unit: "Hz" };
  };

  // Keep display and ref aligned with props; push clamped value up if parent is out of range.
  // Do not depend on onChangeHz — unstable inline handlers would reset local display while typing.
  // While focused, do not rewrite displayValue (avoids forcing ".000" on every keystroke).
  useEffect(() => {
    if (!Number.isFinite(valueHz)) return;
    const cappedHz = clampFrequencyHz(valueHz, minHz, maxHz);
    hzRef.current = cappedHz;
    if (!isFocusedRef.current) {
      const { val, unit } = getOptimalUnit(cappedHz);
      setDisplayValue(val.toFixed(3));
      setDisplayUnit(unit);
    }
    if (cappedHz !== valueHz) {
      onChangeRef.current(cappedHz);
    }
  }, [valueHz, minHz, maxHz]);

  const handleUpdate = (newHz: number, forceRefreshUI = false) => {
    const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);
    
    // Always notify parent of the capped value
    onChangeHz(cappedHz);
    
    // Immediate local update for responsiveness
    hzRef.current = cappedHz;

    if (cappedHz !== newHz || forceRefreshUI) {
      const { val, unit } = getOptimalUnit(cappedHz);
      setDisplayValue(val.toFixed(3));
      setDisplayUnit(unit);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      
      const direction = e.key === "ArrowUp" ? 1 : -1;
      const shiftMultiplier = e.shiftKey ? 10 : 1;
      
      let stepHz = 1;
      if (displayUnit === "kHz") stepHz = 1_000;
      else if (displayUnit === "MHz") stepHz = 100_000; // 0.1MHz step for better precision
      else if (displayUnit === "GHz") stepHz = 10_000_000; // 10MHz step

      const currentHz = Number.isFinite(hzRef.current)
        ? hzRef.current
        : valueHz;
      const nextHz = currentHz + (direction * stepHz * shiftMultiplier);
      handleUpdate(nextHz, true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setDisplayValue(valStr);

    const val = parseFloat(valStr);
    if (Number.isFinite(val)) {
      let multiplier = 1;
      if (displayUnit === "kHz") multiplier = 1_000;
      else if (displayUnit === "MHz") multiplier = 1_000_000;
      else if (displayUnit === "GHz") multiplier = 1_000_000_000;
      
      const newHz = val * multiplier;
      const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);

      if (cappedHz !== newHz) {
        setDisplayValue((cappedHz / multiplier).toFixed(3));
      }

      onChangeHz(cappedHz);
      hzRef.current = cappedHz;
    }
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    const cappedHz = clampFrequencyHz(valueHz, minHz, maxHz);
    const { val, unit } = getOptimalUnit(cappedHz);
    setDisplayValue(val.toFixed(3));
    setDisplayUnit(unit);
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value;
    setDisplayUnit(newUnit);
    
    // Recalculate display value based on new unit
    let multiplier = 1;
    if (newUnit === "kHz") multiplier = 1_000;
    else if (newUnit === "MHz") multiplier = 1_000_000;
    else if (newUnit === "GHz") multiplier = 1_000_000_000;
    
    setDisplayValue((hzRef.current / multiplier).toFixed(3));
  };

  return (
    <InputContainer>
      <StyledInput
        type="text"
        value={displayValue}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onChange={handleInputChange}
        onBlur={handleBlur}
      />
      <UnitSelect value={displayUnit} onChange={handleUnitChange}>
        <option value="Hz">Hz</option>
        <option value="kHz">kHz</option>
        <option value="MHz">MHz</option>
        <option value="GHz">GHz</option>
      </UnitSelect>
    </InputContainer>
  );
};

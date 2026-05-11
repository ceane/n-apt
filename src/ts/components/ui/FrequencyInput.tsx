import React, { useState, useEffect, useRef } from "react";
import { styled } from "styled-components";
import {
  clampFrequencyHz,
  getFrequencyUnitScale,
  getOptimalFrequencyScale,
} from "@n-apt/utils/frequency";

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
  stepHz?: number;
  label?: string;
  id?: string;
}

export const FrequencyInput: React.FC<FrequencyInputProps> = React.memo(({
  valueHz,
  onChangeHz,
  minHz = 0,
  maxHz = 30_000_000_000,
  stepHz,
  id,
}) => {
  const [displayValue, setDisplayValue] = useState<string>("0");
  const [displayUnit, setDisplayUnit] = useState<string>("Hz");
  
  const hzRef = useRef(valueHz);
  const onChangeRef = useRef(onChangeHz);
  onChangeRef.current = onChangeHz;
  const isFocusedRef = useRef(false);
  const lastSyncHzRef = useRef<number | null>(null);
  const prevValueHzRef = useRef<number>(NaN);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!Number.isFinite(valueHz)) return;

    const isFirstRun = isNaN(prevValueHzRef.current);
    const valueChanged = isFirstRun || Math.abs(valueHz - prevValueHzRef.current) > 0.1;
    prevValueHzRef.current = valueHz;
    
    // If we've recently sent an update, check if this prop is just an acknowledgment of that update.
    // If it is, and we've already moved on to a newer local value (e.g. rapid arrow key hits),
    // we must ignore this stale acknowledgment.
    const matchesLocal = Math.abs(valueHz - hzRef.current) < 0.1;
    
    if (!isFirstRun && (matchesLocal || !valueChanged)) {
      return;
    }
    
    // Proceed with syncing parent prop to local state
    const cappedHz = clampFrequencyHz(valueHz, minHz, maxHz);
    hzRef.current = cappedHz;
    
    if (cappedHz !== valueHz) {
      onChangeRef.current(cappedHz);
    }
    
    const isFocused = isFocusedRef.current || document.activeElement === inputRef.current;
    if (!isFocused || isFirstRun) {
      const { value, unit } = getOptimalFrequencyScale(cappedHz);
      setDisplayValue(value.toFixed(3));
      setDisplayUnit(unit);
    }
  }, [valueHz, minHz, maxHz]);

  const handleUpdate = (newHz: number, forceRefreshUI = false) => {
    const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);

    // Synchronously update local tracking refs
    hzRef.current = cappedHz;
    onChangeRef.current(cappedHz);

    if (cappedHz !== newHz || forceRefreshUI) {
      const { value, unit } = getOptimalFrequencyScale(cappedHz);
      setDisplayValue(value.toFixed(3));
      setDisplayUnit(unit);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // stopPropagation is CRITICAL to prevent React Flow from capturing arrow keys
      e.stopPropagation();
      e.preventDefault();
      
      const direction = e.key === "ArrowUp" ? 1 : -1;
      const shiftMultiplier = e.shiftKey ? 10 : 1;
      
      const currentHz = hzRef.current;
      const { unit: currentOptimalUnit } = getOptimalFrequencyScale(currentHz);
      
      let resolvedStepHz = Number.isFinite(stepHz) && stepHz! > 0 ? stepHz! : 1;
      if (!stepHz) {
        if (currentOptimalUnit === "kHz") resolvedStepHz = 1_000;
        else if (currentOptimalUnit === "MHz") resolvedStepHz = 1_000_000;
        else if (currentOptimalUnit === "GHz") resolvedStepHz = 1_000_000_000;
      }

      handleUpdate(currentHz + (direction * resolvedStepHz * shiftMultiplier), true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value.replace(/\s+/g, "");
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

      lastSyncHzRef.current = cappedHz;
      onChangeRef.current(cappedHz);
      hzRef.current = cappedHz;
    }
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    // Always sync back to the high-precision ref on blur to fix any formatting drift
    const cappedHz = clampFrequencyHz(hzRef.current, minHz, maxHz);
    const { value, unit } = getOptimalFrequencyScale(cappedHz);
    setDisplayValue(value.toFixed(3));
    setDisplayUnit(unit);
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value;
    setDisplayUnit(newUnit);

    const multiplier = getFrequencyUnitScale(newUnit as "Hz" | "kHz" | "MHz" | "GHz");
    
    setDisplayValue((hzRef.current / multiplier).toFixed(3));
  };

  return (
    <InputContainer>
      <StyledInput
        id={id}
        ref={inputRef}
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
});

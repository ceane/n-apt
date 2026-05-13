import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { styled } from "styled-components";
import {
  clampFrequencyHz,
  getFrequencyUnitScale,
  getOptimalFrequencyScale,
} from "@n-apt/utils/frequency";

const OuterContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
`;

const Label = styled.label`
  font-size: 10px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const InputContainer = styled.div`
  display: flex;
  gap: 2px;
  width: 100%;
`;

const StyledInput = styled.input`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 4px 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.mono};
  flex: 1;
  min-width: 0;

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
  padding: 2px;
  font-size: 9px;
  font-family: ${({ theme }) => theme.typography.mono || "monospace"};
  color: ${({ theme }) => theme.colors.primary};
  min-width: 30px;
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
  label,
  id,
}) => {
  // Use useMemo for initial scale to avoid flicker on first mount
  const initialScale = useMemo(() => getOptimalFrequencyScale(valueHz), []);
  const [displayValue, setDisplayValue] = useState<string>(initialScale.value.toFixed(3));
  const [displayUnit, setDisplayUnit] = useState<string>(initialScale.unit);
  
  // Track focus state to prevent prop updates from clobbering user input
  const isFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Track current value in Hz for internal calculations
  const hzRef = useRef(valueHz);
  const prevValueHzRef = useRef(valueHz);

  // Synchronize internal state with props when NOT focused
  useEffect(() => {
    // Check if the current value is valid
    const clamped = clampFrequencyHz(valueHz, minHz, maxHz);
    if (Math.abs(clamped - valueHz) > 0.001) {
      // Value is invalid, notify parent to correct it
      onChangeHz(clamped);
      return;
    }

    // Only update internal state if the prop differs from our current known value
    if (Math.abs(valueHz - hzRef.current) < 0.001) return;

    hzRef.current = valueHz;
    prevValueHzRef.current = valueHz;

    // Only update display strings if the user is not actively editing
    if (!isFocusedRef.current) {
      const { value, unit } = getOptimalFrequencyScale(valueHz);
      setDisplayValue(value.toFixed(3));
      setDisplayUnit(unit);
    }
  }, [valueHz]);

  const handleUpdate = useCallback((newHz: number, forceRefreshUI = false) => {
    const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);
    hzRef.current = cappedHz;
    prevValueHzRef.current = cappedHz;
    onChangeHz(cappedHz);

    if (forceRefreshUI) {
      const { value, unit } = getOptimalFrequencyScale(cappedHz);
      setDisplayValue(value.toFixed(3));
      setDisplayUnit(unit);
    }
  }, [minHz, maxHz, onChangeHz]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.stopPropagation();
      e.preventDefault();
      
      const direction = e.key === "ArrowUp" ? 1 : -1;
      const shiftMultiplier = e.shiftKey ? 10 : 1;
      
      const currentHz = hzRef.current;
      const { unit: currentOptimalUnit } = getOptimalFrequencyScale(currentHz);
      
      // If stepHz is provided, use it. Otherwise, use a smart step based on current unit.
      let resolvedStepHz = 1;
      if (Number.isFinite(stepHz) && stepHz! > 0) {
        resolvedStepHz = stepHz!;
      } else {
        if (displayUnit === "kHz") resolvedStepHz = 1_000;
        else if (displayUnit === "MHz") resolvedStepHz = 1_000_000;
        else if (displayUnit === "GHz") resolvedStepHz = 1_000_000_000;
      }

      handleUpdate(currentHz + (direction * resolvedStepHz * shiftMultiplier), true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value.replace(/\s+/g, "");
    setDisplayValue(valStr);

    const val = parseFloat(valStr);
    if (Number.isFinite(val)) {
      const multiplier = getFrequencyUnitScale(displayUnit as any);
      const newHz = val * multiplier;
      const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);

      // Don't refresh the UI string while typing unless it's clamped
      if (Math.abs(cappedHz - newHz) > 0.1) {
        setDisplayValue((cappedHz / multiplier).toFixed(3));
      }

      hzRef.current = cappedHz;
      prevValueHzRef.current = cappedHz;
      onChangeHz(cappedHz);
    }
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    // On blur, normalize the display value
    const { value, unit } = getOptimalFrequencyScale(hzRef.current);
    setDisplayValue(value.toFixed(3));
    setDisplayUnit(unit);
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value;
    setDisplayUnit(newUnit);
    const multiplier = getFrequencyUnitScale(newUnit as any);
    setDisplayValue((hzRef.current / multiplier).toFixed(3));
  };

  return (
    <OuterContainer>
      {label && <Label htmlFor={id}>{label}</Label>}
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
          autoComplete="off"
          spellCheck={false}
        />
        <UnitSelect value={displayUnit} onChange={handleUnitChange}>
          <option value="Hz">Hz</option>
          <option value="kHz">kHz</option>
          <option value="MHz">MHz</option>
          <option value="GHz">GHz</option>
        </UnitSelect>
      </InputContainer>
    </OuterContainer>
  );
});

export default FrequencyInput;

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { styled } from "styled-components";
import {
  clampFrequencyHz,
  getFrequencyUnitScale,
  getOptimalFrequencyScale,
  formatFrequencyHz,
  formatFrequencyValue,
  trimNumericString,
  type FrequencyUnit,
} from "@n-apt/utils/frequency";

const OuterContainer = styled.div<{ $isOpen?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  position: relative;
  z-index: ${({ $isOpen }) => ($isOpen ? 1000 : "auto")};
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
  align-items: center;
  gap: 6px;
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
  cursor: ew-resize;

  &::placeholder {
    color: ${({ theme }) => theme.colors.textMuted};
    opacity: 1;
  }

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary}22;
    cursor: text;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`;

const UnitControl = styled.div<{ $isOpen?: boolean }>`
  position: relative;
  z-index: ${({ $isOpen }) => ($isOpen ? 1000 : 1)};
`;

const UnitButton = styled.button`
  background: ${({ theme }) =>
    theme.colors.surface || "rgba(255, 255, 255, 0.05)"};
  border: 1px solid
    ${({ theme }) => theme.colors.border || "rgba(255, 255, 255, 0.1)"};
  border-radius: 4px;
  padding: 2px;
  font-size: 9px;
  font-family: ${({ theme }) => theme.typography.mono || "monospace"};
  color: ${({ theme }) => theme.colors.primary};
  min-width: 44px;
  width: 44px;
  height: 24px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.border}44;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const UnitMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 60px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 10px 24px
    ${({ theme }) =>
      theme.mode === "light"
        ? "rgba(31, 37, 50, 0.14)"
        : "rgba(0, 0, 0, 0.34)"};
  overflow: hidden;
  z-index: 20;
`;

const UnitOption = styled.button<{ $active?: boolean }>`
  border: 0;
  border-radius: 0;
  background: ${({ theme, $active }) =>
    $active ? `${theme.colors.primary}1f` : theme.colors.surface};
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textPrimary};
  cursor: pointer;
  font-family: ${({ theme }) => theme.typography.mono || "monospace"};
  font-size: 10px;
  padding: 7px 10px;
  text-align: left;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const FREQUENCY_UNITS: FrequencyUnit[] = ["Hz", "kHz", "MHz", "GHz"];

const logFrequencyInputUnitEvent = (
  eventName: string,
  details: Record<string, unknown>,
) => {
  console.debug("[FrequencyInput:unit]", eventName, details);
};

interface FrequencyInputProps {
  valueHz: number;
  onChangeHz: (hz: number) => void;
  minHz?: number;
  maxHz?: number;
  stepHz?: number;
  label?: string;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  commitOnBlur?: boolean;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  className?: string;
  onMenuOpenChange?: (isOpen: boolean) => void;
}

export const FrequencyInput: React.FC<FrequencyInputProps> = React.memo(
  ({
    valueHz,
    onChangeHz,
    minHz = 0,
    maxHz = 30_000_000_000,
    stepHz,
    label,
    id,
    placeholder,
    autoFocus,
    commitOnBlur,
    onBlur,
    onKeyDown,
    disabled,
    className,
    onMenuOpenChange,
  }) => {
    // Derive the initial display from the first rendered value.
    const initialScale = useMemo(
      () => getOptimalFrequencyScale(valueHz),
      [valueHz],
    );
    const [displayValue, setDisplayValue] = useState<string>(
      trimNumericString(formatFrequencyValue(initialScale.value)),
    );
    const [displayUnit, setDisplayUnit] = useState<string>(initialScale.unit);
    const [isUnitMenuOpen, setIsUnitMenuOpen] = useState(false);

    useEffect(() => {
      onMenuOpenChange?.(isUnitMenuOpen);
    }, [isUnitMenuOpen, onMenuOpenChange]);

    // Track focus state to prevent prop updates from clobbering user input
    const isFocusedRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const outerContainerRef = useRef<HTMLDivElement>(null);

    // Track current value in Hz for internal calculations
    const hzRef = useRef(valueHz);
    const prevValueHzRef = useRef(valueHz);

    useEffect(() => {
      const clamped = clampFrequencyHz(valueHz, minHz, maxHz);
      if (Math.abs(clamped - valueHz) > 0.001) {
        onChangeHz(clamped);
        return;
      }

      if (Math.abs(valueHz - hzRef.current) < 0.001) {
        return;
      }

      hzRef.current = valueHz;
      prevValueHzRef.current = valueHz;

      if (!isFocusedRef.current) {
        const { value, unit } = getOptimalFrequencyScale(valueHz);
        setDisplayValue(trimNumericString(formatFrequencyValue(value)));
        setDisplayUnit(unit);
      }
    }, [valueHz]);

    const handleUpdate = useCallback(
      (newHz: number, forceRefreshUI = false) => {
        const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);
        hzRef.current = cappedHz;
        prevValueHzRef.current = cappedHz;
        onChangeHz(cappedHz);

        if (forceRefreshUI) {
          const { value, unit } = getOptimalFrequencyScale(cappedHz);
          setDisplayUnit(unit);
          setDisplayValue(
            unit === "Hz"
              ? formatFrequencyHz(cappedHz)
              : trimNumericString(formatFrequencyValue(value)),
          );
        }
      },
      [minHz, maxHz, onChangeHz],
    );

    const dragStartRef = useRef<{
      x: number;
      value: number;
      unit: string;
    } | null>(null);
    const hasDraggedRef = useRef(false);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (e.button !== 0) return; // Only left click
        dragStartRef.current = {
          x: e.clientX,
          value: hzRef.current,
          unit: displayUnit,
        };
        hasDraggedRef.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      [disabled, displayUnit],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLInputElement>) => {
        if (!dragStartRef.current) return;
        const deltaX = e.clientX - dragStartRef.current.x;

        if (!hasDraggedRef.current) {
          if (Math.abs(deltaX) > 3) {
            hasDraggedRef.current = true;
            inputRef.current?.focus();
          }
        }

        if (hasDraggedRef.current) {
          e.preventDefault();
          e.stopPropagation();

          let baseStep = 1;
          const dragUnit = dragStartRef.current.unit;
          if (dragUnit === "kHz") baseStep = 1_000;
          else if (dragUnit === "MHz") baseStep = 1_000_000;
          else if (dragUnit === "GHz") baseStep = 10_000_000;

          let multiplier = 1;
          if (e.shiftKey) multiplier = 10;
          else if (e.altKey) multiplier = 0.1;

          const deltaHz = e.movementX * baseStep * multiplier;
          const newHz = hzRef.current + deltaHz;
          handleUpdate(newHz, true);
        }
      },
      [displayUnit, handleUpdate],
    );

    const handlePointerUp = useCallback(
      (e: React.PointerEvent<HTMLInputElement>) => {
        if (!dragStartRef.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragStartRef.current = null;

        if (hasDraggedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          inputRef.current?.blur();
          inputRef.current?.focus();
        }
      },
      [],
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.stopPropagation();
        e.preventDefault();

        const direction = e.key === "ArrowUp" ? 1 : -1;
        const shiftMultiplier = e.shiftKey ? 10 : 1;

        const currentHz = hzRef.current;

        // If stepHz is provided, use it. Otherwise, use a smart step based on current unit.
        let resolvedStepHz = 1;
        if (Number.isFinite(stepHz) && stepHz! > 0) {
          resolvedStepHz = stepHz!;
        } else {
          if (displayUnit === "kHz") resolvedStepHz = 1_000;
          else if (displayUnit === "MHz") resolvedStepHz = 1_000_000;
          else if (displayUnit === "GHz") resolvedStepHz = 1_000_000_000;
        }

        handleUpdate(
          currentHz + direction * resolvedStepHz * shiftMultiplier,
          true,
        );
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const valStr = e.target.value.replace(/\s+/g, "");
      setDisplayValue(valStr);

      if (commitOnBlur) {
        return;
      }

      const val = parseFloat(valStr);
      if (Number.isFinite(val)) {
        const multiplier = getFrequencyUnitScale(displayUnit as any);
        const newHz = val * multiplier;
        const cappedHz = clampFrequencyHz(newHz, minHz, maxHz);

        // Don't refresh the UI string while typing unless it's clamped
        if (Math.abs(cappedHz - newHz) > 0.1) {
          setDisplayValue(
            trimNumericString(formatFrequencyValue(cappedHz / multiplier)),
          );
        }

        hzRef.current = cappedHz;
        prevValueHzRef.current = cappedHz;
        onChangeHz(cappedHz);
      }
    };

    const handleFocus = () => {
      if (disabled) return;
      isFocusedRef.current = true;
    };

    const handleUnitChange = (newUnit: FrequencyUnit) => {
      if (disabled) return;
      logFrequencyInputUnitEvent("change", {
        from: displayUnit,
        to: newUnit,
        hz: hzRef.current,
      });
      setDisplayUnit(newUnit);
      setIsUnitMenuOpen(false);
      setDisplayValue(
        newUnit === "Hz"
          ? formatFrequencyHz(hzRef.current)
          : trimNumericString(
              formatFrequencyValue(
                hzRef.current / getFrequencyUnitScale(newUnit),
              ),
            ),
      );
    };

    const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
      if (disabled) return;

      const nextFocus = e.relatedTarget as Node | null;
      if (nextFocus && outerContainerRef.current?.contains(nextFocus)) {
        logFrequencyInputUnitEvent("container-blur-inside", {
          displayUnit,
          menuOpen: isUnitMenuOpen,
        });
        return;
      }

      logFrequencyInputUnitEvent("container-blur-outside", {
        displayUnit,
        menuOpen: isUnitMenuOpen,
        commitOnBlur: !!commitOnBlur,
      });
      setIsUnitMenuOpen(false);
      isFocusedRef.current = false;

      if (commitOnBlur) {
        const val = parseFloat(displayValue.replace(/\s+/g, ""));
        if (Number.isFinite(val)) {
          const multiplier = getFrequencyUnitScale(displayUnit as any);
          const newHz = val * multiplier;
          handleUpdate(newHz, true);
        } else {
          const { value, unit } = getOptimalFrequencyScale(hzRef.current);
          setDisplayValue(trimNumericString(formatFrequencyValue(value)));
          setDisplayUnit(unit);
        }
        onBlur?.();
        return;
      }

      const { value, unit } = getOptimalFrequencyScale(hzRef.current);
      setDisplayUnit(unit);
      setDisplayValue(
        unit === "Hz"
          ? formatFrequencyHz(hzRef.current)
          : trimNumericString(formatFrequencyValue(value)),
      );
      onBlur?.();
    };

    const unitButtonRef = useRef<HTMLButtonElement>(null);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

    useEffect(() => {
      if (isUnitMenuOpen && unitButtonRef.current) {
        const rect = unitButtonRef.current.getBoundingClientRect();
        setMenuStyle({
          position: "fixed",
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
          zIndex: 100000,
        });
      }
    }, [isUnitMenuOpen]);

    return (
      <OuterContainer
        ref={outerContainerRef}
        className={`${className || ""} ${isUnitMenuOpen ? "leva-unit-menu-open" : ""}`}
        onBlur={handleContainerBlur}
        $isOpen={isUnitMenuOpen}
      >
        {label && <Label htmlFor={id}>{label}</Label>}
        <InputContainer>
          <StyledInput
            id={id}
            ref={inputRef}
            type="text"
            value={displayValue}
            onFocus={handleFocus}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (!event.defaultPrevented) {
                handleKeyDown(event);
              }
            }}
            onChange={handleInputChange}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
          />
          <UnitControl $isOpen={isUnitMenuOpen}>
            <UnitButton
              ref={unitButtonRef}
              type="button"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={isUnitMenuOpen}
              aria-label="Frequency unit"
              onPointerDown={(event) => {
                logFrequencyInputUnitEvent("button-pointerdown", {
                  displayUnit,
                  menuOpen: isUnitMenuOpen,
                  disabled: !!disabled,
                });
                event.preventDefault();
                event.stopPropagation();
                if (!disabled) {
                  setIsUnitMenuOpen((open) => !open);
                }
              }}
              onClick={(event) => {
                logFrequencyInputUnitEvent("button-click", {
                  displayUnit,
                  menuOpen: isUnitMenuOpen,
                  disabled: !!disabled,
                });
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {displayUnit}
            </UnitButton>
            {isUnitMenuOpen &&
              createPortal(
                <UnitMenu
                  role="listbox"
                  aria-label="Frequency unit options"
                  style={menuStyle}
                >
                  {FREQUENCY_UNITS.map((unit) => (
                    <UnitOption
                      key={unit}
                      type="button"
                      role="option"
                      aria-selected={unit === displayUnit}
                      $active={unit === displayUnit}
                      onPointerDown={(event) => {
                        logFrequencyInputUnitEvent("option-pointerdown", {
                          displayUnit,
                          unit,
                        });
                        event.preventDefault();
                        event.stopPropagation();
                        handleUnitChange(unit);
                      }}
                      onClick={(event) => {
                        logFrequencyInputUnitEvent("option-click", {
                          displayUnit,
                          unit,
                        });
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      {unit}
                    </UnitOption>
                  ))}
                </UnitMenu>,
                document.body,
              )}
          </UnitControl>
        </InputContainer>
      </OuterContainer>
    );
  },
);

export default FrequencyInput;

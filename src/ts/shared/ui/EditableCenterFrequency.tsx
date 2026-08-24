import React, { useEffect, useRef } from "react";
import { styled } from "styled-components";
import { FrequencyInput } from "./FrequencyInput";
import { resolveEdgeClampedCenterHz } from "@n-apt/math/frequency";

const MAX_CENTER_FREQUENCY_HZ = 30_000_000_000;

interface EditableCenterFrequencyProps {
  centerFrequencyHz: number;
  onCenterFrequencyChange: (centerFrequencyHz: number) => void;
  onClose: () => void;
  className?: string;
  placement?: "top" | "bottom";
  /** When mirror-below-0Hz is on, allow typing a negative display center. */
  allowNegativeFrequencies?: boolean;
  /**
   * Width of the acquisition window. When set, committing a center at the
   * spectrum ceiling corrects the center so the window's *edge* lands on the
   * ceiling instead of pushing half the window past it (which the backend
   * would reject).
   */
  windowSpanHz?: number | null;
}

const Shell = styled.div<{ $placement: "top" | "bottom" }>`
  position: absolute;
  left: 50%;
  ${({ $placement }) => ($placement === "top" ? "top: 10px;" : "bottom: 10px;")}
  transform: translateX(-50%);
  z-index: 140;
  width: min(58vw, 300px);
  pointer-events: none;
`;

const Card = styled.div`
  pointer-events: auto;
  width: 100%;
  border-radius: 24px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 10px 30px
    ${({ theme }) =>
      theme.mode === "light"
        ? "rgba(31, 37, 50, 0.12)"
        : "rgba(0, 0, 0, 0.32)"};
  backdrop-filter: blur(10px);
  padding: 10px 12px;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const EditorTitle = styled.div`
  margin-bottom: 8px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  font-family: ${({ theme }) => theme.typography.mono};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const CenterFrequencyField = styled(FrequencyInput)`
  width: 100%;

  &,
  & > div {
    width: 100%;
  }

  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;

  label {
    display: none;
  }

  input {
    flex: 1;
    min-width: 0;
    border-radius: 0;
    border: 0;
    background: transparent;
    padding: 0;
    font-size: 22px;
    line-height: 1.05;
    color: ${({ theme }) => theme.colors.textPrimary};
    font-family: ${({ theme }) => theme.typography.mono};
    letter-spacing: 0.03em;
    box-shadow: none;
  }

  input::placeholder {
    color: ${({ theme }) => theme.colors.textMuted};
    opacity: 1;
  }

  button[aria-label="Frequency unit"] {
    min-width: 52px;
    height: 34px;
    border-radius: 0;
    border: 0;
    background: transparent;
    color: ${({ theme }) => theme.colors.textSecondary};
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }
`;

const EditorHint = styled.div`
  margin-top: 8px;
  text-align: center;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textMuted};
  letter-spacing: 0.04em;
`;

export const EditableCenterFrequency: React.FC<
  EditableCenterFrequencyProps
> = ({
  centerFrequencyHz,
  onCenterFrequencyChange,
  onClose,
  className,
  placement = "bottom",
  allowNegativeFrequencies = false,
  windowSpanHz = null,
}) => {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const minHz = allowNegativeFrequencies ? -MAX_CENTER_FREQUENCY_HZ : 0;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell) return;

      const path = event.composedPath();
      const inside = path.includes(shell);
      if (!inside) {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const commitCenterFrequency = (nextCenterFrequencyHz: number) => {
    // The spectrum cap applies to window edges, not the center: entering
    // the max must land the window's upper edge on the cap (and, in mirror
    // mode, the lower edge on the negative ceiling).
    const committed = resolveEdgeClampedCenterHz(
      nextCenterFrequencyHz,
      typeof windowSpanHz === "number" ? windowSpanHz : NaN,
      allowNegativeFrequencies ? -MAX_CENTER_FREQUENCY_HZ : Number.NEGATIVE_INFINITY,
      MAX_CENTER_FREQUENCY_HZ,
    );
    onCenterFrequencyChange(committed);
    onClose();
  };

  return (
    <Shell ref={shellRef} className={className} $placement={placement}>
      <Card>
        <EditorTitle>Center Frequency / Onscreen Canvas</EditorTitle>
        <Bar>
          <CenterFrequencyField
            valueHz={centerFrequencyHz}
            onChangeHz={commitCenterFrequency}
            minHz={minHz}
            maxHz={MAX_CENTER_FREQUENCY_HZ}
            placeholder="x.xxx.xxx"
            autoFocus
            commitOnBlur
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="editable-center-frequency-input"
          />
        </Bar>
        <EditorHint>
          Press Enter to set, Esc or click outside to close
        </EditorHint>
      </Card>
    </Shell>
  );
};

export default EditableCenterFrequency;

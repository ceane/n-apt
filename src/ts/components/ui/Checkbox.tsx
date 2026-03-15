import React from "react";
import styled from "styled-components";

export const CheckboxContainer = styled.label<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  font-size: 11px;
  color: #ccc;
  user-select: none;
`;

export const HiddenCheckbox = styled.input.attrs({ type: "checkbox" })`
  border: 0;
  clip: rect(0 0 0 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
`;

const Icon = styled.svg`
  fill: none;
  stroke: white;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
`;

export const StyledCheckbox = styled.div<{ $checked: boolean }>`
  display: inline-block;
  width: 16px;
  height: 16px;
  background: ${({ $checked }) => ($checked ? "#0088cc" : "#212121")};
  border: 1px solid ${({ $checked }) => ($checked ? "#0088cc" : "#333")};
  border-radius: 4px;
  transition: all 150ms;
  display: flex;
  align-items: center;
  justify-content: center;

  ${HiddenCheckbox}:focus + & {
    box-shadow: 0 0 0 2px rgba(0, 136, 204, 0.3);
  }

  ${Icon} {
    visibility: ${({ $checked }) => ($checked ? "visible" : "hidden")};
    width: 12px;
    height: 12px;
  }
`;

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, label, disabled, ...props }, ref) => (
    <CheckboxContainer className={className} $disabled={disabled}>
      <HiddenCheckbox
        checked={checked}
        disabled={disabled}
        ref={ref}
        {...props}
      />
      <StyledCheckbox $checked={!!checked}>
        <Icon viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </Icon>
      </StyledCheckbox>
      {label && <span>{label}</span>}
    </CheckboxContainer>
  ),
);

Checkbox.displayName = "Checkbox";

export default Checkbox;

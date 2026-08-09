import React from "react";
import styled from "styled-components";

const Button = styled.button`
  position: absolute;
  right: 32px;
  bottom: 32px;
  z-index: 40;
  padding: 20px 40px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 16px;
  background: ${(props) => props.theme.primary};
  color: ${(props) => props.theme.background};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  transition:
    transform 0.18s ease,
    filter 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    filter: brightness(1.06);
    transform: translateY(-2px);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.32);
  }

  &:active {
    transform: translateY(0);
  }
`;

export interface SkipIntroButtonProps {
  onClick: () => void;
}

export const SkipIntroButton: React.FC<SkipIntroButtonProps> = ({ onClick }) => (
  <Button type="button" onClick={onClick}>
    Skip Intro
  </Button>
);

export default SkipIntroButton;

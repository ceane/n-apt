import styled from "styled-components";
import { theme } from "../../../theme";

export const OverlayText = styled.div<{
  $top?: string;
  $right?: string;
  $bottom?: string;
  $left?: string;
  $align?: "left" | "center" | "right";
  $color?: string;
  $weight?: number;
  $fontSize?: string;
}>`
  position: absolute;
  top: ${({ $top }) => $top ?? "auto"};
  right: ${({ $right }) => $right ?? "auto"};
  bottom: ${({ $bottom }) => $bottom ?? "auto"};
  left: ${({ $left }) => $left ?? "auto"};
  transform: ${({ $align, $left }) => ($align === "center" && $left === "50%" ? "translateX(-50%)" : "none")};
  font-family: ${theme.fonts.mono};
  font-size: ${({ $fontSize }) => $fontSize ?? theme.fontSizes.normal};
  line-height: 1.2;
  color: ${({ $color }) => $color ?? theme.colors.textSecondary};
  font-weight: ${({ $weight }) => $weight ?? 500};
  text-align: ${({ $align }) => $align ?? "left"};
  max-width: min(32vw, 260px);

  @media (max-width: 640px) {
    font-size: 0.68rem;
    max-width: 42vw;
  }
`;

export const WaveLabel = styled.span`
  position: absolute;
  transform: translateX(-50%);
  color: ${theme.colors.text};
  font-family: ${theme.fonts.mono};
  font-size: ${theme.fontSizes.small};
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2;
  text-align: center;
`;

export const WaveLabelAnnotation = styled.span`
  font-weight: normal;
`;

export const ZeroLine = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px solid ${theme.colors.borderSecondary};
  pointer-events: none;
  z-index: 1;
`;

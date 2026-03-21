import { css } from "styled-components";

export const contentVisibilityAuto = (
  blockSize: string,
  inlineSize: string = "auto",
) => css`
  @supports (content-visibility: auto) {
    content-visibility: auto;
    contain: layout style paint;
    contain-intrinsic-size: ${blockSize} ${inlineSize};
  }
`;

export const contentVisibilityHidden = (
  blockSize: string,
  inlineSize: string = "auto",
) => css`
  @supports (content-visibility: hidden) {
    content-visibility: hidden;
    contain: layout style paint;
    contain-intrinsic-size: ${blockSize} ${inlineSize};
  }
`;

export const containSize = css`
  @supports (contain: size) {
    contain: size;
  }
`;

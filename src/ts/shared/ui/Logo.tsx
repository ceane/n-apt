import React from "react";
import styled, { css } from "styled-components";
import nAptLogo from "@n-apt/public/images/icon.svg";

const LogoImage = styled.img<{ $size: string }>`
  display: block;
  flex-shrink: 0;
  width: ${(props) => props.$size};
  height: ${(props) => props.$size};
  object-fit: contain;
  filter: none;
  mix-blend-mode: darken;

  ${(props) =>
    props.theme.mode === "dark" &&
    css`
      filter: invert(1);
      mix-blend-mode: screen;
    `}
`;

export interface LogoProps {
  /** Pixel size or any valid CSS width/height (e.g. clamp). */
  size?: number | string;
  alt?: string;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  size = 128,
  alt = "N-APT",
  className,
}) => {
  const dimension = typeof size === "number" ? `${size}px` : size;

  return (
    <LogoImage
      className={className}
      src={nAptLogo}
      alt={alt}
      $size={dimension}
    />
  );
};

export default Logo;

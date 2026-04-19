import React from 'react';
import styled from 'styled-components';
import { assetImageUrl } from '../../../utils/asset-helpers';

interface CanvasImageProps {
  src: string; // Relative path from public/md-preview/, e.g., "omni-tower.svg"
  alt: string;
  position?: 'absolute' | 'relative' | 'fixed';
  right?: string;
  left?: string;
  top?: string;
  bottom?: string;
  height?: string;
  width?: string;
  maxHeight?: string;
  maxWidth?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  transform?: string;
  zIndex?: number;
  pointerEvents?: 'none' | 'auto';
  opacity?: number;
}

const StyledImage = styled.img<{
  $position?: 'absolute' | 'relative' | 'fixed';
  $right?: string;
  $left?: string;
  $top?: string;
  $bottom?: string;
  $height?: string;
  $width?: string;
  $maxHeight?: string;
  $maxWidth?: string;
  $objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  $transform?: string;
  $zIndex?: number;
  $pointerEvents?: 'none' | 'auto';
  $opacity?: number;
}>`
  position: ${props => props.$position || 'absolute'};
  right: ${props => props.$right || 'auto'};
  left: ${props => props.$left || 'auto'};
  top: ${props => props.$top || 'auto'};
  bottom: ${props => props.$bottom || 'auto'};
  height: ${props => props.$height || 'auto'};
  width: ${props => props.$width || 'auto'};
  max-height: ${props => props.$maxHeight || 'none'};
  max-width: ${props => props.$maxWidth || 'none'};
  object-fit: ${props => props.$objectFit || 'contain'};
  transform: ${props => props.$transform || 'none'};
  z-index: ${props => props.$zIndex || 1};
  pointer-events: ${props => props.$pointerEvents || 'auto'};
  opacity: ${props => props.$opacity || 1};
`;

export const CanvasImage: React.FC<CanvasImageProps> = ({
  src,
  alt,
  position,
  right,
  left,
  top,
  bottom,
  height,
  width,
  maxHeight,
  maxWidth,
  objectFit,
  transform,
  zIndex,
  pointerEvents,
  opacity,
}) => {
  const fullSrc = assetImageUrl(src);

  return (
    <StyledImage
      src={fullSrc}
      alt={alt}
      $position={position}
      $right={right}
      $left={left}
      $top={top}
      $bottom={bottom}
      $height={height}
      $width={width}
      $maxHeight={maxHeight}
      $maxWidth={maxWidth}
      $objectFit={objectFit}
      $transform={transform}
      $zIndex={zIndex}
      $pointerEvents={pointerEvents}
      $opacity={opacity}
      loading="lazy"
    />
  );
};

export default CanvasImage;

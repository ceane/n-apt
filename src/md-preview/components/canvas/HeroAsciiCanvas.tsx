'use client';

import React from 'react';
import AsciiMotionAnimation from './ascii-motion-animation';

export function HeroAsciiCanvas(props: { autoPlay?: boolean; showControls?: boolean }) {
  return <AsciiMotionAnimation autoPlay={props.autoPlay ?? true} showControls={props.showControls ?? false} />;
}
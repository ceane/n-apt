import React, { useRef, useEffect, useState, ReactNode } from 'react';
import styled from 'styled-components';
import { LevaPanel } from 'leva';
import { motion, AnimatePresence } from 'framer-motion';

const HarnessContainer = styled.div<{ $aspectRatio: string }>`
  width: 100%;
  position: relative;
  overflow: hidden;
  contain: strict;
  border-radius: 12px;
  background-color: #E0E0E2;
  background-image:
    linear-gradient(to right, #D7D8DA 2px, transparent 2px),
    linear-gradient(to bottom, #D7D8DA 2px, transparent 2px);
  background-size: 64px 64px;
  background-position: center bottom;
  aspect-ratio: ${(props) => props.$aspectRatio};
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
  color: #111827;
  margin: 1.5rem 0;
  border: 1px solid rgba(42, 42, 42, 0.1);

  &.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 1000;
    border-radius: 0;
    aspect-ratio: unset;
    margin: 0;
  }

  @media (max-width: 640px) {
    width: 100vw;
    margin-left: 50%;
    transform: translateX(-50%);
    border: none;
    border-radius: 0;
    border-left: none;
    border-right: none;
    margin-right: calc(-50vw + 100%);
  }
`;

const TextOverlayContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 8;
`;

const ControlPanel = styled(motion.div)`
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 10;
  width: 20rem;
  max-width: calc(100vw - 2rem);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid rgba(42, 42, 42, 0.3);
  background-color: rgba(255, 255, 255, 0.8);
  pointer-events: auto;
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
`;

const ControlsToggleDot = styled.div`
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 1.25rem;
  height: 1.25rem;
  background-color: rgba(42, 42, 42, 0.3);
  border-radius: 50%;
  cursor: pointer;
  z-index: 9;
  transition: background-color 0.2s, transform 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;

  &:hover {
    background-color: rgba(42, 42, 42, 0.6);
    transform: scale(1.1);
  }

  &::after {
    content: '';
    width: 0.5rem;
    height: 0.5rem;
    background-color: white;
    border-radius: 50%;
    opacity: 0.8;
  }
`;

const ErrorBoundaryFallback = styled.div`
  padding: 2rem;
  color: #ef4444;
  font-family: monospace;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 0.5rem;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
`;

interface CanvasHarnessProps {
  children: ReactNode;
  store?: any; // Leva store instance
  aspectRatio?: string;
  className?: string;
  fallbackContent?: ReactNode;
  showToggleDot?: boolean;
}

export function CanvasHarness({
  children,
  store,
  aspectRatio = '16/9',
  className,
  fallbackContent = <div>Loading Visualization...</div>,
  showToggleDot = true
}: CanvasHarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Add a small buffer to start loading slightly before coming into view
          if (entry.isIntersecting) {
            setIsVisible(true);
          } else {
            // Unmount if out of viewport entirely
            setIsVisible(false);
          }
        });
      },
      { rootMargin: '200px 0px 200px 0px', threshold: 0 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleToggleControls = () => {
    setShowControls(prev => !prev);
  };

  return (
    <HarnessContainer
      ref={containerRef}
      $aspectRatio={aspectRatio}
      className={`${className || ''} ${isFullscreen ? 'fullscreen' : ''}`}
    >
      {/* 
        Only mount the heavy canvas children when visible.
        This fixes the out-of-memory issue for many heavy WebGPU/Three.js canvases.
      */}
      {isVisible ? children : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {fallbackContent}
        </div>
      )}

      {store && showToggleDot && (
        <>
          <ControlsToggleDot
            onClick={handleToggleControls}
            title={showControls ? "Hide Controls" : "Show Controls"}
            style={{
              opacity: showControls ? 0 : 1,
              pointerEvents: showControls ? 'none' : 'auto'
            }}
          />

          <AnimatePresence>
            {showControls && (
              <ControlPanel
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                drag
                dragMomentum={false}
                style={{ touchAction: 'none' }}
              >
                {/* Close button inside the panel to revert to the dot */}
                <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', zIndex: 20, cursor: 'pointer' }} onClick={handleToggleControls}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </div>
                <LevaPanel
                  store={store}
                  fill
                  flat
                  titleBar={{ title: 'Parameters', filter: false }}
                  theme={{
                    colors: {
                      elevation1: 'rgba(255, 255, 255, 0.95)',
                      elevation2: '#E0E0E2',
                      elevation3: 'rgba(42, 42, 42, 0.2)',
                      accent1: '#3B82F6',
                      highlight1: '#111827',
                      toolTipBackground: 'rgba(255, 255, 255, 0.9)',
                      toolTipText: '#111827',
                    }
                  }}
                />
              </ControlPanel>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Optional Fullscreen Toggle could be added here in the future */}
    </HarnessContainer>
  );
}

export default CanvasHarness;

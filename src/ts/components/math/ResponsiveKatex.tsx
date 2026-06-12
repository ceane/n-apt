import React from "react";
import styled, { css } from "styled-components";

export type ResponsiveKatexMode = "all" | "desktop-only" | "mobile-only";

export const desktopOnlyStyles = css`
  @media (max-width: 768px) {
    display: none !important;
  }
`;

export const mobileOnlyStyles = css`
  display: none !important;
  @media (max-width: 768px) {
    display: block !important;
  }
`;

const Wrapper = styled.div<{ $mode: ResponsiveKatexMode }>`
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;

  ${({ $mode }) => $mode === "desktop-only" && desktopOnlyStyles}
  ${({ $mode }) => $mode === "mobile-only" && mobileOnlyStyles}

  .katex-display {
    width: 100%;
    max-width: 100%;
    margin: 6px 0;
    text-align: center;
    padding: 0;
    transition: font-size 0.2s ease;
    min-height: 2em;
    position: relative;
    
    /* Precise breakpoints for LaTeX font scaling */
    font-size: 1.1em;
    @media (max-width: 1024px) { font-size: 1.0em; }
    @media (max-width: 768px) { font-size: 0.9em; }
    @media (max-width: 480px) { font-size: 0.8em; }
  }

  .katex-display > .katex {
    display: inline-block;
    max-width: none;
    white-space: nowrap;
    vertical-align: middle;
    width: auto !important;
  }

  .katex {
    font-size: 1.05em;
    text-rendering: optimizeLegibility;
  }
`;

/**
 * Responsive KaTeX wrapper: renders pre-rendered KaTeX HTML at natural
 * size, then uses a ResizeObserver to scale it so it always fills the
 * full container width. Scales up when narrower, down when wider.
 * Height adjusts to match the scaled content.
 *
 * requestAnimationFrame batches the work to avoid layout thrashing.
 */
export const ResponsiveKatex: React.FC<{
  html: string;
  mode?: ResponsiveKatexMode;
}> = ({ html, mode = "all" }) => {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const wrapper = wrapRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner) return;

    let rafId = 0;

    const fit = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // Reset transform to measure natural (intrinsic) size
        inner.style.transform = "none";

        const nw = inner.scrollWidth;
        const nh = inner.offsetHeight;
        const cw = wrapper.clientWidth;
        if (cw <= 0 || nw <= 0) return;

        const s = Math.min(1, cw / nw);
        if (Math.abs(s - 1) > 0.005) {
          inner.style.transform = `scale(${s})`;
          inner.style.transformOrigin = "top center";
          // Set wrapper height to match scaled content so nothing clips
          wrapper.style.height = `${nh * s}px`;
        } else {
          wrapper.style.height = "auto";
        }
      });
    };

    const ro = new ResizeObserver(fit);
    ro.observe(wrapper);
    ro.observe(inner);
    fit();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [html, mode]);

  return (
    <Wrapper ref={wrapRef} $mode={mode}>
      <div
        ref={innerRef}
        style={{
          display: "inline-block",
          transformOrigin: "top center",
          whiteSpace: "nowrap",
          width: "max-content",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Wrapper>
  );
};

export const DesktopOnly = styled.div`
  ${desktopOnlyStyles}
`;

export const MobileOnly = styled.div`
  ${mobileOnlyStyles}
`;

export default ResponsiveKatex;

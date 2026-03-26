import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle, css } from "styled-components";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import * as lucideIcons from "lucide-react";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import BodyAttenuationCanvas from "./BodyAttenuationWebGPUCanvas";
import ImpedanceCanvas from "./ImpedanceCanvas";
import TimeOfFlightCanvas from "./TimeOfFlightCanvas";
import { AmplitudeModulationCanvas, FrequencyModulationCanvas, HeterodyningCanvas, MultipathCanvas } from "./SignalCanvases";
import PhaseShiftingCanvas from "./PhaseShfitingCanvas";
import remarkBodyAttenuationBlocks from "./remarkBodyAttenuationBlocks";
import remarkTimeOfFlightBlocks from "./remarkTimeOfFlightBlocks";
import remarkSignalCanvasBlocks from "./remarkSignalCanvasBlocks";
import remarkIconShortcodes from "./remarkIconShortcodes";
import remarkLatexCodeBlocks from "./remarkLatexCodeBlocks";
import GiscusComments from "./GiscusComments";

const DEFAULT_SOURCE = "/pages/how-do-they-do-it.md";
const BASE_URL = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

const candidateAssetPaths = (relativePath: string) => {
  const sanitized = relativePath.replace(/^\/+/, "");
  const dedupe = new Set<string>();
  const add = (path: string) => dedupe.add(path.replace(/\/+/g, "/"));

  if (BASE_URL && BASE_URL !== "/") {
    add(`${BASE_URL}/${sanitized}`);
  }
  add(`/${sanitized}`);

  return Array.from(dedupe);
};

const BLEND_IMAGE_PATTERNS = ["bart-line-drawing", "first-installment-nsa"];
const HERO_IMAGE_PATTERNS = ["hero-light", "hero-dark"];

const MarkdownImage: React.FC<MarkdownImageProps> = ({ src = "", alt = "", ...imgProps }) => {
  const normalizedSrc = src.toLowerCase();
  const normalizedAlt = alt.toLowerCase();

  const shouldBlend = BLEND_IMAGE_PATTERNS.some((pattern) =>
    normalizedSrc.includes(pattern) || normalizedAlt.includes(pattern)
  );

  const isHero = HERO_IMAGE_PATTERNS.some((pattern) =>
    normalizedSrc.includes(pattern) || normalizedAlt.includes(pattern)
  );

  return (
    <Figure $blend={shouldBlend} $hero={isHero}>
      <img src={src} alt={alt} {...imgProps} />
    </Figure>
  );
};

const decodeExpressions = (serialized = "") => {
  try {
    const parsed = JSON.parse(decodeURIComponent(serialized));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

const renderDisplayExpression = (expression: string) => katex.renderToString(expression, {
  throwOnError: false,
  displayMode: true,
  strict: "warn",
  output: "html",
});

type LatexBlockProps = React.HTMLAttributes<HTMLElement> & {
  "data-expressions"?: string;
};

const LatexBlock: React.FC<LatexBlockProps> = ({ "data-expressions": serializedExpressions = "" }) => {
  const expressions = useMemo(() => decodeExpressions(serializedExpressions), [serializedExpressions]);
  const renderedExpressions = useMemo(
    () => expressions.map((expression) => renderDisplayExpression(expression)),
    [expressions],
  );
  const blockRef = useRef<HTMLDivElement | null>(null);
  const expressionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useLayoutEffect(() => {
    const resizeExpressions = () => {
      expressionRefs.current.forEach((expressionNode) => {
        if (!expressionNode) {
          return;
        }

        const displayNode = expressionNode.querySelector(":scope > .katex-display") as HTMLElement | null;
        const katexNode = displayNode?.querySelector(":scope > .katex") as HTMLElement | null;

        if (!displayNode || !katexNode) {
          return;
        }

        expressionNode.style.height = "";
        displayNode.style.height = "";
        katexNode.style.transform = "";
        katexNode.style.transformOrigin = "left top";

        const availableWidth = expressionNode.clientWidth;
        const requiredWidth = katexNode.scrollWidth;
        const naturalHeight = katexNode.scrollHeight;

        if (availableWidth > 0 && requiredWidth > availableWidth) {
          const scale = Math.max((availableWidth / requiredWidth) * 0.98, 0.58);
          katexNode.style.transform = `scale(${scale})`;
          const scaledHeight = naturalHeight * scale;
          displayNode.style.height = `${scaledHeight}px`;
          expressionNode.style.height = `${scaledHeight}px`;
        }
      });
    };

    resizeExpressions();

    const resizeObserver = new ResizeObserver(() => {
      resizeExpressions();
    });

    if (blockRef.current) {
      resizeObserver.observe(blockRef.current);
    }

    window.addEventListener("resize", resizeExpressions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeExpressions);
    };
  }, [renderedExpressions]);

  expressionRefs.current = [];

  return (
    <LatexBlockContainer ref={blockRef}>
      {renderedExpressions.map((html, index) => (
        <LatexExpressionRow
          key={`${index}-${expressions[index] ?? ""}`}
          ref={(node: HTMLDivElement | null) => {
            expressionRefs.current[index] = node;
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ))}
    </LatexBlockContainer>
  );
};

const App: React.FC = () => {
  const [activeSource] = useState(DEFAULT_SOURCE);
  const [markdown, setMarkdown] = useState<string>("");

  const fetchMarkdown = useCallback(async (path: string) => {
    const normalizedPath = path.trim() || DEFAULT_SOURCE;
    for (const assetPath of candidateAssetPaths(normalizedPath)) {
      try {
        const response = await fetch(assetPath, { headers: { "Cache-Control": "no-cache" } });
        if (response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("text/html")) {
            throw new Error("Received HTML fallback instead of markdown");
          }

          const text = await response.text();
          setMarkdown(text);
          return;
        }
      } catch {
        // Silently try next candidate
      }
    }
    // Silently fail; UI will show fallback message
  }, []);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) {
      return;
    }

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    if (!markdown) {
      return;
    }

    const hash = window.location.hash;
    const scrollingElement = document.scrollingElement;

    if (!hash || !scrollingElement) {
      return;
    }

    const targetId = hash.slice(1);
    const element = document.getElementById(targetId);

    if (!element) {
      return;
    }

    const targetTop = element.getBoundingClientRect().top + scrollingElement.scrollTop;
    scrollingElement.scrollTop = targetTop;
  }, [markdown]);

  useEffect(() => {
    void fetchMarkdown(activeSource);
  }, [activeSource, fetchMarkdown]);

  useEffect(() => {
    if (!import.meta.hot) {
      return;
    }

    const handleUpdate = (payload: { path?: string }) => {
      if (!payload?.path) {
        return;
      }
      const normalized = payload.path.startsWith("/") ? payload.path : `/${payload.path}`;
      if (normalized === activeSource) {
        void fetchMarkdown(activeSource);
      }
    };

    import.meta.hot.on("pages:update", handleUpdate);
    return () => {
      import.meta.hot?.off("pages:update", handleUpdate);
    };
  }, [activeSource, fetchMarkdown]);

  const markdownComponents = useMemo<Components>(() => ({
    a: ({ node: _node, ...props }) => {
      const isFootnoteRef = (props as any)['data-footnote-ref'] !== undefined;
      const isFootnoteBackRef = (props as any)['data-footnote-backref'] !== undefined;
      const href = (props as any).href || '';

      const isInternalLink = href.startsWith('#');

      if (isFootnoteRef || isFootnoteBackRef) {
        return <CitationLinkWrapper $citation {...props} />;
      }

      if (isInternalLink) {
        return <CitationLinkWrapper {...props} />;
      }

      return <MarkdownLink target="_blank" rel="noreferrer" {...props} />;
    },
    img: ({ node: _node, ...props }) => <MarkdownImage {...props} />,
    "latex-block": (props: any) => <LatexBlock {...(props as LatexBlockProps)} />,
    "body-attenuation-canvas": BodyAttenuationCanvas,
    "impedance-canvas": ImpedanceCanvas,
    "time-of-flight-canvas": TimeOfFlightCanvas,
    "phase-shifting-canvas": PhaseShiftingCanvas,
    "frequency-modulation-canvas": FrequencyModulationCanvas,
    "amplitude-modulation-canvas": AmplitudeModulationCanvas,
    "multipath-canvas": MultipathCanvas,
    "heterodyning-canvas": HeterodyningCanvas,
    "icon-inline": IconInline,
  }), []);

  return (
    <>
      <GlobalStyle />
      <Page>
        <ArticleContent>
          <ReactMarkdown
            remarkPlugins={[
              remarkGfm,
              remarkIconShortcodes,
              remarkLatexCodeBlocks,
              remarkBodyAttenuationBlocks,
              remarkTimeOfFlightBlocks,
              remarkSignalCanvasBlocks,
            ]}
            rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
            components={markdownComponents}
          >
            {markdown || "_Fetching markdown…_"}
          </ReactMarkdown>
          {activeSource && (
            <GiscusComments pageId={activeSource} />
          )}
        </ArticleContent>
      </Page>
    </>
  );
};

const GlobalStyle = createGlobalStyle`
  @import url("https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@500;600;700&display=swap");

  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html {
    scroll-behavior: auto !important;
  }
  body {
    margin: 0;
    font-family: "DM Mono", "JetBrains Mono", "Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: #283780;
    color: #f3f6ff;
    min-height: 100vh;
    scroll-behavior: auto !important;
  }
`;

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0;
  min-width: 0;
`;

const ArticleContent = styled.article`
  max-width: 800px;
  margin: 0 auto;
  padding: clamp(32px, 5vw, 72px);
  color: #acbaff;
  line-height: 1.7;
  font-size: clamp(0.95rem, 1.2vw, 1.1rem);
  overflow-x: hidden;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: normal;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    font-weight: 700;
    line-height: 1.3;
    margin-top: 2.5em;
    margin-bottom: 1.2em;
    color: #9eaeff;
  }

  h1 {
    font-size: clamp(2rem, 5vw, 3.2rem);
  }

  h2 {
    font-size: clamp(1.6rem, 4vw, 2.4rem);
  }

  h3 {
    font-size: clamp(1.3rem, 3vw, 1.8rem);
  }

  p {
    margin: 1.2em 0;
    font-family: "DM Mono", monospace;
    font-weight: 300;
    color: #acbaff;
    overflow-wrap: anywhere;
  }

  a {
    color: #acbaff;
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-color: currentColor;
    text-decoration-thickness: 2.5px;
    text-underline-offset: 4px;
    overflow-wrap: anywhere;

    &:hover {
      text-decoration-style: solid;
    }
  }

  ul,
  ol {
    padding-left: 1.8em;
    margin: 1.2em 0;
    font-family: "DM Mono", monospace;
    font-weight: 300;
    color: #acbaff;
    overflow-wrap: anywhere;
  }

  li {
    margin-bottom: 0.6em;
    overflow-wrap: anywhere;
  }

  blockquote {
    margin: 2em 0;
    padding: 1.2em 1.8em;
    border-left: 4px solid #9eaeff;
    background: rgba(172, 186, 255, 0.12);
    border-radius: 0 8px 8px 0;
    font-style: italic;
    font-family: "DM Mono", monospace;
    font-weight: 300;
    color: #d0d8ff;
    overflow-wrap: anywhere;
  }

  code {
    font-family: "JetBrains Mono", monospace;
    background: rgba(255, 255, 255, 0.08);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }

  strong {
    font-family: "JetBrains Mono", monospace;
    font-weight: 600;
    color: #d0d8ff;
  }

  pre {
    background: #0a0c1e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 1.2em;
    overflow-x: auto;
    max-width: 100%;
    margin: 1.5em 0;

    code {
      background: transparent;
      padding: 0;
      font-size: 0.9em;
      line-height: 1.5;
    }
  }

  table {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    margin: 2em 0;
    font-size: 0.95em;
    background: #1d2f7a;
    border: 1px solid #1a275c;
    border-radius: 12px;
    overflow: hidden;
    font-family: "DM Mono", monospace;
    font-weight: 300;
    color: #acbaff;
  }

  th,
  td {
    padding: 1rem 1.4rem;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    overflow-wrap: anywhere;
    word-break: normal;
  }

  th {
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9eaeff;
    background: #263b8f;
  }

  td {
    color: #acbaff;
    background: #0f1647;
  }

  td:first-child {
    color: #9eaeff;
  }

  tr:nth-child(even) td {
    background: #131d55;
  }

  tr:last-child td {
    border-bottom: none;
  }

  hr {
    border: none;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 3em 0;
  }

  /* Footnote styling */
  .footnotes {
    margin-top: 3em;
    padding-top: 2em;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.9em;
    line-height: 1.6;
  }

  .footnotes ol {
    padding-left: 1.5em;
    margin: 0;
  }

  .footnotes li {
    margin-bottom: 1em;
    padding-left: 0.5em;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
  }

  .footnotes p {
    margin: 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .footnotes a {
    word-break: break-all;
  }
`;

const MarkdownLink = styled.a`
  color: #6c85ff;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: currentColor;
  text-underline-offset: 2px;
`;

const InternalLink = styled.button`
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  margin: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  outline: none;
  box-shadow: none;
  line-height: inherit;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: currentColor;
  text-decoration-thickness: 2.5px;
  text-underline-offset: 4px;

  &:hover {
    text-decoration-style: solid;
  }

  &:focus,
  &:focus-visible,
  &:active {
    outline: none;
    box-shadow: none;
  }
`;

type InternalLinkProps = React.PropsWithChildren<{
  href?: string;
  $citation?: boolean;
}>;

const CitationButton = styled(InternalLink)`
  text-decoration: none;

  &:hover {
    text-decoration-line: underline;
    text-decoration-style: solid;
    text-decoration-color: currentColor;
    text-decoration-thickness: 2.5px;
    text-underline-offset: 4px;
  }
`;

const CitationLinkWrapper: React.FC<InternalLinkProps> = ({ children, href, $citation = false }) => {
  const handleClick = () => {
    if (!href || !href.startsWith("#")) {
      return;
    }

    const targetId = href.slice(1);
    const element = document.getElementById(targetId);
    const scrollingElement = document.scrollingElement;

    if (!element || !scrollingElement) {
      return;
    }

    const targetTop = element.getBoundingClientRect().top + scrollingElement.scrollTop;
    scrollingElement.scrollTop = targetTop;
    window.history.replaceState(null, "", href);
  };

  return (
    $citation ? (
      <CitationButton type="button" onClick={handleClick}>
        {children}
      </CitationButton>
    ) : (
      <InternalLink type="button" onClick={handleClick}>
        {children}
      </InternalLink>
    )
  );
};

const LatexBlockContainer = styled.div`
  display: grid;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  margin: 1.5em 0;
`;

const LatexExpressionRow = styled.div`
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  margin: 0 0 1.25em;

  &:last-child {
    margin-bottom: 0;
  }

  & > .katex-display {
    width: 100%;
    max-width: 100%;
    margin: 0;
    overflow: hidden;
    text-align: center;
    font-size: 1.18em;
  }

  & > .katex-display > .katex {
    display: inline-block;
    max-width: 100%;
  }
`;

const Figure = styled.figure<{ $blend?: boolean; $hero?: boolean }>`
  margin: 1.5em 0;
  position: relative;
  width: 100%;
  display: block;

  & > img {
    display: block;
    width: 100%;
    height: auto;
    max-width: 100%;
    border-radius: ${({ $hero }) => ($hero ? "0" : "12px")};
    border: ${({ $hero }) => ($hero ? "none" : "unset")};
  }

  ${({ $blend }) =>
    $blend &&
    css`
      & > img {
        mix-blend-mode: multiply;
        filter: brightness(1.1) contrast(1.7);
      }

      &::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 12px;
        pointer-events: none;
      }
    `}
`;

const IconWrapper = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0 0.15em;
  padding: 0;
  vertical-align: middle;
  line-height: 0;
`;

const IconFallback = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 0.85em;
  color: #9eaeff;
`;

type IconElementProps = React.HTMLAttributes<HTMLElement> & {
  "data-icon"?: string;
};

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement>;

const slugToComponentName = (slug = "") => {
  const parts = slug
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  const name = parts.join("");
  // Lucide usually doesnt suffix with 'Icon' in the exports, but some tools do.
  // The standard names are like 'ShieldCheck', 'Bug', 'Album'.
  return name;
};

const IconInline: React.FC<IconElementProps> = ({ "data-icon": slug }) => {
  if (!slug) {
    return null;
  }

  const componentName = slugToComponentName(slug);
  const candidate = (lucideIcons as Record<string, any>)[componentName];

  // Also try with 'Icon' suffix just in case, though standard lucide-react doesn't need it
  const IconComponent = (typeof candidate === "function" || (candidate && typeof candidate.render === "function"))
    ? candidate
    : (lucideIcons as Record<string, any>)[`${componentName}Icon`];

  if (!IconComponent) {
    return <IconFallback>{`:${slug}:`}</IconFallback>;
  }

  return (
    <IconWrapper>
      <IconComponent size={18} strokeWidth={1.8} />
    </IconWrapper>
  );
};

declare global {
  interface Window {
    markdownPreview?: {
      rerender: () => void;
      setSource: (nextSource: string) => void;
    };
  }
}

export default App;

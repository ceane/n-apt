import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import styled, { createGlobalStyle, css, ThemeProvider } from "styled-components";
import { Agentation } from "agentation";
import { theme } from "@n-apt/app-article/consts/theme";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import * as lucideIcons from "lucide-react"; // We'll keep this for now but it's large; usually one would use dynamic imports here too if many icons are needed.
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
const AmplitudeModulationCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.AmplitudeModulationCanvas })));
const FrequencyModulationCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.FrequencyModulationCanvas })));
const HeterodyningCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.HeterodyningCanvas })));
const MultipathCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.MultipathCanvas })));
const PhaseShiftingCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.PhaseShiftingCanvas })));
const TriangulationMapCanvas = lazy(() => import("@n-apt/app-article/components/canvas/TriangulationMapCanvas"));
const TriangulationCloseEnoughCanvas = lazy(() => import("@n-apt/app-article/components/canvas/TriangulationCloseEnoughCanvas"));
const TimeOfFlightCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.TimeOfFlightCanvas })));
const ImpedanceCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.ImpedanceCanvas })));
const BodyAttenuationCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.BodyAttenuationCanvas })));
const EndpointRangeCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.EndpointRangeCanvas })));
const HeroAsciiCanvas = lazy(() => import("@n-apt/app-article/components/canvas").then(m => ({ default: m.HeroAsciiCanvas })));
import remarkBodyAttenuationBlocks from "@n-apt/app-article/utils/remarkBodyAttenuationBlocks";
import remarkTimeOfFlightBlocks from "@n-apt/app-article/utils/remarkTimeOfFlightBlocks";
import remarkSignalCanvasBlocks from "@n-apt/app-article/utils/remarkSignalCanvasBlocks";
import remarkIconShortcodes from "@n-apt/app-article/utils/remarkIconShortcodes";
import remarkLatexCodeBlocks from "@n-apt/app-article/utils/remarkLatexCodeBlocks";
import remarkReactDaysSinceBlocks from "@n-apt/app-article/utils/remarkReactDaysSinceBlocks";
import GiscusComments from "@n-apt/app-article/components/GiscusComments";
import { DaysSince } from "@n-apt/app-article/components/DaysSince";
import { assetUrl, assetPageUrl } from "@n-apt/app-article/utils/asset-helpers";
import { registerMarkdownHotReload } from "@n-apt/app-article/utils/hmr";
import { CanvasHarness } from "@n-apt/app-article/components/canvas/CanvasHarness";
import { ResponsiveKatex, desktopOnlyStyles, mobileOnlyStyles, DesktopOnly, MobileOnly } from "@n-apt/math/ResponsiveKatex";

const LEGACY_CANVAS_IMPORT_PATH = "@n-apt/ts/components/canvas";

const DEFAULT_SOURCE = "/pages/how-do-they-do-it.md";
void LEGACY_CANVAS_IMPORT_PATH;

const BLEND_IMAGE_MAP: Record<string, string> = {
  "bart-line-drawing": "blend-image",
  "first-installment-nsa": "blend-image",
  "n-apt-channels-wavelength-comparison": "invert-lighten",
};
const HERO_IMAGE_PATTERNS = ["hero-light", "hero-dark"];
const CanvasPlaceholder = styled.div`
  width: 100%;
  height: 400px;
  background: rgba(172, 186, 255, 0.05);
  border: 1px dashed rgba(172, 186, 255, 0.2);
  border-radius: 12px;
  margin: 1.5em 0;
  display: flex;
  align-items: center;
  justify-content: center;
  &:after {
    content: "Loading visualization...";
    color: #acbaff;
    font-size: 0.9em;
    opacity: 0.5;
  }
`;

const MarkdownImage: React.FC<MarkdownImageProps> = ({ src = "", alt = "", ...imgProps }) => {
  const normalizedSrc = src.toLowerCase();
  const normalizedAlt = alt.toLowerCase();

  const blendClass = Object.entries(BLEND_IMAGE_MAP).find(([pattern]) =>
    normalizedSrc.includes(pattern) || normalizedAlt.includes(pattern)
  )?.[1];

  const isHero = HERO_IMAGE_PATTERNS.some((pattern) =>
    normalizedSrc.includes(pattern) || normalizedAlt.includes(pattern)
  );

  return (
    <Figure $blendClass={blendClass} $hero={isHero}>
      <img src={assetUrl(src)} alt={alt} loading="lazy" {...imgProps} />
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", margin: "1.5em 0" }}>
      {renderedExpressions.map((html, index) => (
        <ResponsiveKatex key={`${index}-${expressions[index] ?? ""}`} html={html} />
      ))}
    </div>
  );
};

const App: React.FC = () => {
  const [activeSource] = useState(DEFAULT_SOURCE);
  const [markdown, setMarkdown] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchMarkdown = useCallback(async (path: string, bustCache = false) => {
    const normalizedPath = path.trim() || DEFAULT_SOURCE;
    const url = assetPageUrl(normalizedPath);
    const requestUrl = bustCache ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
    try {
      const response = await fetch(requestUrl, {
        headers: { "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          throw new Error("Received HTML fallback instead of markdown");
        }

        const text = await response.text();
        setMarkdown(text);
        setLoadError(null);
        return;
      }
      throw new Error(`Failed to fetch markdown: ${response.status} ${response.statusText}`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load markdown");
    }
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
    const handleUpdate = (payload: { path?: string }) => {
      if (!payload?.path) {
        return;
      }
      const normalized = payload.path.startsWith("/") ? payload.path : `/${payload.path}`;
      if (normalized === activeSource) {
        void fetchMarkdown(activeSource, true);
      }
    };

    return registerMarkdownHotReload(handleUpdate);
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
    p: ({ node: _node, ...props }) => {
      const { children } = props;
      // If the paragraph contains block-level components (images, canvases, latex),
      // we 'plop them out' by returning only the children without the <p> wrapper.
      // This maintains valid HTML hierarchy.
      const hasBlockElement = React.Children.toArray(children).some(
        (child) => React.isValidElement(child) && typeof child.type !== "string"
      );
      return hasBlockElement ? <>{children}</> : <p {...props} className="markdown-para" />;
    },
    img: ({ node: _node, ...props }) => <MarkdownImage {...props} />,
    "latex-block": ({ node: _node, ...props }: any) => <LatexBlock {...(props as LatexBlockProps)} />,
    "body-attenuation-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <BodyAttenuationCanvas {...props} /> </Suspense>,
    "impedance-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <ImpedanceCanvas {...props} /> </Suspense>,
    "time-of-flight-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <TimeOfFlightCanvas {...props} /> </Suspense>,
    "phase-shifting-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <PhaseShiftingCanvas {...props} /> </Suspense>,
    "frequency-modulation-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <FrequencyModulationCanvas {...props} /> </Suspense>,
    "amplitude-modulation-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <AmplitudeModulationCanvas {...props} /> </Suspense>,
    "multipath-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <MultipathCanvas {...props} /> </Suspense>,
    "heterodyning-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <HeterodyningCanvas {...props} /> </Suspense>,
    "endpoint-range-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <EndpointRangeCanvas {...props} /> </Suspense>,
    "triangulation-map-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <TriangulationMapCanvas {...props} /> </Suspense>,
    "triangulation-close-enough-canvas": ({ node: _node, ...props }: any) => <Suspense fallback={<CanvasPlaceholder />}> <TriangulationCloseEnoughCanvas {...props} /> </Suspense>,
    "hero-ascii-canvas": ({ node: _node, ...props }: any) => (
      <CanvasHarness aspectRatio="16/9" showToggleDot={false} transparent>
        <Suspense fallback={<CanvasPlaceholder />}>
          <HeroAsciiCanvas {...props} />
        </Suspense>
      </CanvasHarness>
    ),
    "icon-inline": ({ node: _node, ...props }: any) => <IconInline {...props} />,
    "desktop-only": ({ node: _node, children, ...props }: any) => <DesktopOnly {...props}>{children}</DesktopOnly>,
    "mobile-only": ({ node: _node, children, ...props }: any) => <MobileOnly {...props}>{children}</MobileOnly>,
    "days-since": () => <DaysSince />,
    table: ({ node: _node, ...props }) => (
      <div className="table-scroll-wrapper table-dense">
        <table {...props} />
      </div>
    ),
  }), []);

  return (
    <ThemeProvider theme={theme as any}>
      <GlobalStyle />
      <Page>
        <ScrollToContents href="#table-of-contents">Scroll to Contents</ScrollToContents>
        <ArticleContent>
          <ReactMarkdown
            remarkPlugins={[
              remarkGfm,
              remarkIconShortcodes,
              remarkLatexCodeBlocks as any,
              remarkReactDaysSinceBlocks as any,
              remarkBodyAttenuationBlocks as any,
              remarkTimeOfFlightBlocks,
              remarkSignalCanvasBlocks as any,
            ]}
            rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
            components={markdownComponents}
          >
            {loadError ? `# Could not load markdown\n\n${loadError}` : (markdown || "_Fetching markdown…_")}
          </ReactMarkdown>
          {!__DEV__ && activeSource && (
            <GiscusComments pageId={activeSource} />
          )}
        </ArticleContent>
        {process.env.NODE_ENV === "development" &&
          <Agentation endpoint="http://localhost:4747" />}
      </Page>
    </ThemeProvider>
  );
};

const GlobalStyle = createGlobalStyle`
  :root { 
    color-scheme: dark;
    --bg: #283780;
  }
  * { box-sizing: border-box; }
  html {
    scroll-behavior: auto !important;
  }
  body {
    margin: 0;
    font-family: "DM Mono", "JetBrains Mono", "Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg);
    color: #f3f6ff;
    min-height: 100vh;
    scroll-behavior: auto !important;
  }
  .desktop-only {
    ${desktopOnlyStyles}
  }
  .mobile-only {
    ${mobileOnlyStyles}
  }
`;

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0;
  min-width: 0;
`;

const ScrollToContents = styled.a`
  position: fixed;
  right: 24px;
  top: 50px;
  color: #9eaeff;
  text-decoration: none;
  font-size: 0.85rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(158, 174, 255, 0.2);
  z-index: 100;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);

  &:hover {
    background: rgba(40, 55, 128, 0.95);
    border-color: rgba(158, 174, 255, 0.4);
  }

  @media (max-width: 768px) {
    display: none;
  }
`;

const ArticleContent = styled.article`
  max-width: 800px;
  margin: 0 auto;
  padding: clamp(32px, 5vw, 72px);
  color: #acbaff;
  line-height: 1.7;
  font-size: clamp(0.95rem, 1.2vw, 1.1rem);
  overflow-x: visible;
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

    sup {
      font-size: 0.65em;
    }
  }

  h1 {
    font-size: clamp(2rem, 5vw, 3.2rem);
    margin-top: 1.5rem;
  }

  h2 {
    font-size: clamp(1.6rem, 4vw, 2.4rem);
  }

  h3 {
    font-size: clamp(1.3rem, 3vw, 1.8rem);
  }

  .dropcap {
    font-family: "JetBrains Mono", monospace;
    font-size: clamp(3.5rem, 8vw, 4.5rem);
    float: left;
    line-height: 0.8;
    margin-top: 0.05em;
    margin-right: 0.12em;
    font-weight: 800;
    background: linear-gradient(135deg, #9eaeff 0%, #acbaff 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 0 20px rgba(158, 174, 255, 0.15);
  }

  p,
  .markdown-para {
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
    background: color-mix(in srgb, var(--bg), black 20%);
    border: 1px solid color-mix(in srgb, var(--bg), white 10%);
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
    background: color-mix(in srgb, var(--bg), white 5%);
  }

  td {
    color: #acbaff;
    background: color-mix(in srgb, var(--bg), black 60%);
  }

  td:first-child {
    color: #9eaeff;
  }

  tr:nth-child(even) td {
    background: color-mix(in srgb, var(--bg), black 50%);
  }

  tr:last-child td {
    border-bottom: none;
  }

  .table-scroll-wrapper {
    width: 100%;
    overflow-x: auto;
    margin: 2em 0;
    -webkit-overflow-scrolling: touch;
    
    /* Custom scrollbar for tables */
    &::-webkit-scrollbar {
      height: 4px;
    }
    &::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
    }
  }

  .table-dense, .table-tiny {
    width: 100%;
    
    table {
      table-layout: auto !important;
      margin: 0 !important;
    }

    th, td {
      padding: 0.75rem !important;
      font-size: 0.9rem !important;
      text-transform: none;
    }

    @media (max-width: 768px) {
      th, td {
        padding: 0.5rem !important;
        font-size: 0.8rem !important;
      }
    }
  }

  .table-tiny {
    @media (max-width: 768px) {
      th, td {
        padding: 0.3rem 0.4rem !important;
        font-size: 0.65rem !important;
        letter-spacing: -0.01em;
      }
    }
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
    word-break: break-all;
  }

  .katex-display {
    margin: 0.8em 0;
    padding: 0.2em 0;
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

const Figure = styled.figure<{ $blendClass?: string | null; $hero?: boolean }>`
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

  ${({ $blendClass }) =>
    $blendClass === "blend-image" &&
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

  ${({ $blendClass }) =>
    $blendClass === "invert-lighten" &&
    css`
      & > img {
        mix-blend-mode: lighten;
        filter: invert(1) brightness(1.2);
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

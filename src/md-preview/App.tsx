import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import * as lucideIcons from "lucide-react";
import "highlight.js/styles/github-dark.css";
import remarkIconShortcodes from "./remarkIconShortcodes";

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

  const markdownComponents = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: (props: any) => <MarkdownLink target="_blank" rel="noreferrer" {...props} />,
    "icon-inline": IconInline,
  }), []);

  return (
    <>
      <GlobalStyle />
      <Page>
        <ArticleContent>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkIconShortcodes]}
            rehypePlugins={[rehypeRaw, rehypeHighlight]}
            components={markdownComponents}
          >
            {markdown || "_Fetching markdown…_"}
          </ReactMarkdown>
        </ArticleContent>
      </Page>
    </>
  );
};

const GlobalStyle = createGlobalStyle`
  @import url("https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@500;600;700&display=swap");

  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "DM Mono", "JetBrains Mono", "Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: #283780;
    color: #f3f6ff;
    min-height: 100vh;
  }
`;

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0;
`;

const ArticleContent = styled.div`
  max-width: 800px;
  margin: 0 auto;
  padding: clamp(32px, 5vw, 72px);
  color: #6c85ff;
  line-height: 1.7;
  font-size: clamp(0.95rem, 1.2vw, 1.1rem);

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
    color: #6c85ff;
  }

  a {
    color: #73ffe8;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.2s;

    &:hover {
      border-bottom-color: #73ffe8;
    }
  }

  ul,
  ol {
    padding-left: 1.8em;
    margin: 1.2em 0;
    font-family: "DM Mono", monospace;
    font-weight: 300;
    color: #6c85ff;
  }

  li {
    margin-bottom: 0.6em;
  }

  blockquote {
    margin: 2em 0;
    padding: 1.2em 1.8em;
    border-left: 4px solid #73ffe8;
    background: rgba(115, 255, 232, 0.08);
    border-radius: 0 8px 8px 0;
    font-style: italic;
    font-family: "DM Mono", monospace;
    font-weight: 300;
    color: #6c85ff;
  }

  code {
    font-family: "JetBrains Mono", monospace;
    background: rgba(255, 255, 255, 0.08);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
  }

  strong {
    font-family: "JetBrains Mono", monospace;
    font-weight: 600;
    color: #9eaeff;
  }

  pre {
    background: #0a0c1e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 1.2em;
    overflow-x: auto;
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
    color: #9eaeff;
  }

  th,
  td {
    padding: 1rem 1.4rem;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
    color: #6c85ff;
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
`;

const MarkdownLink = styled.a`
  color: #73ffe8;
  text-decoration: underline;
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
    console.warn(`[IconInline] Could not find Lucide icon for slug "${slug}" (component name "${componentName}")`);
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

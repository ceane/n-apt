import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AppPublicSidebar,
  PublicMainGrid,
  PublicPage,
  PublicSectionLink,
  PublicShell,
} from "@n-apt/components/layout/AppPublicPageLayout";
import licenseText from "../../../LICENSE?raw";
import responsibleUseText from "../../../RESPONSIBLE_USE.md?raw";

const Body = styled.article`
  line-height: 1.7;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(0.98rem, 0.95rem + 0.15vw, 1.05rem);

  > *:first-child {
    margin-top: 0;
  }

  p,
  ul,
  ol,
  blockquote,
  table,
  pre {
    margin: 0 0 1rem;
  }

  h2,
  h3,
  h4 {
    margin: 2rem 0 0.75rem;
    color: ${(props) => props.theme.textPrimary};
    line-height: 1.2;
    font-family: ${(props) => props.theme.typography.sans};
    font-weight: 700;
    scroll-margin-top: 24px;
  }

  h2 {
    font-size: 1.55rem;
  }

  h3 {
    font-size: 1.2rem;
  }

  h4 {
    font-size: 1.05rem;
  }

  a {
    color: ${(props) => props.theme.primary};
  }

  code {
    font-family: ${(props) => props.theme.typography.mono};
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  ul,
  ol {
    padding-left: 1.5rem;
  }

  li + li {
    margin-top: 0.4rem;
  }

  th,
  td {
    border: 1px solid ${(props) => props.theme.border};
    padding: 10px 12px;
    vertical-align: top;
  }
`;

const ContentHeader = styled.h1`
  margin: 0 0 18px;
  font-size: clamp(28px, 4vw, 40px);
  font-family: ${(props) => props.theme.typography.sans};
  font-weight: 700;
  color: ${(props) => props.theme.textPrimary};
`;

const ErrorBox = styled.div`
  padding: 20px;
  border-radius: 14px;
  border: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textSecondary};
`;

const legalDocs: Record<
  string,
  { title: string; source?: string; content?: string }
> = {
  terms: {
    title: "Terms of Use",
    source: "/pages/terms-of-use.md",
  },
  license: {
    title: "LICENSE",
    content: licenseText,
  },
  responsible_use: {
    title: "Responsible Use Policy",
    content: responsibleUseText,
  },
  privacy: {
    title: "Privacy Policy",
    source: "/pages/privacy-policy.md",
  },
};

const legalNavItems: Record<string, Array<{ label: string; href: string }>> = {
  terms: [
    { label: "Top", href: "#top" },
    { label: "License compliance", href: "#license-compliance" },
    { label: "Responsible use", href: "#responsible-use" },
    { label: "User responsibility", href: "#user-responsibility" },
    {
      label: "No guarantee of correctness",
      href: "#no-guarantee-of-correctness",
    },
    { label: "Risk and availability", href: "#risk-and-availability" },
    { label: "Contact", href: "#contact" },
  ],
  privacy: [
    { label: "Top", href: "#top" },
    {
      label: "Information we may collect",
      href: "#information-we-may-collect",
    },
    { label: "How we use information", href: "#how-we-use-information" },
    { label: "What we do not collect", href: "#what-we-do-not-collect" },
    { label: "California privacy rights", href: "#california-privacy-rights" },
    { label: "GDPR rights", href: "#gdpr-rights" },
    { label: "Data retention", href: "#data-retention" },
    { label: "Security", href: "#security" },
    { label: "Contact", href: "#contact" },
  ],
  license: [
    { label: "Top", href: "#top" },
    { label: "What that means", href: "#what-that-means" },
    { label: "Read the source", href: "#read-the-source" },
  ],
  responsible_use: [
    { label: "Top", href: "#top" },
    { label: "Prohibited uses", href: "#1-prohibited-uses" },
    { label: "Guidance", href: "#2-guidance-for-responsible-use" },
    { label: "Enforcement", href: "#3-enforcement-and-escalation" },
    { label: "Documentation", href: "#4-documentation-and-transparency" },
    { label: "Scenarios", href: "#5-tailored-edge-case-scenarios" },
    { label: "Notes", href: "#6-notes" },
  ],
};

export const LegalDocumentRoute: React.FC = () => {
  const location = useLocation();
  const pageKey =
    location.pathname === "/privacy"
      ? "privacy"
      : location.pathname === "/license"
        ? "license"
        : location.pathname === "/responsible-use"
          ? "responsible_use"
          : "terms";
  const page = legalDocs[pageKey];
  const navItems = legalNavItems[pageKey];
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pageTitle = useMemo(() => page?.title ?? "Legal Document", [page]);

  useEffect(() => {
    if (!page) {
      setMarkdown("");
      setError("Requested document was not found.");
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (page.content) {
        setMarkdown(page.content);
        setError(null);
        return;
      }

      try {
        const response = await fetch(page.source ?? "");
        if (!response.ok) {
          throw new Error(`Failed to load ${page.title.toLowerCase()}`);
        }
        const text = await response.text();
        if (!cancelled) {
          setMarkdown(text);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load legal document.",
          );
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <PublicPage>
      <PublicShell>
        <PublicMainGrid>
          <AppPublicSidebar aria-label={`${pageTitle} navigation`}>
            {navItems.map((item) => (
              <PublicSectionLink key={item.href} href={item.href}>
                {item.label}
              </PublicSectionLink>
            ))}
          </AppPublicSidebar>
          {error ? (
            <ErrorBox>{error}</ErrorBox>
          ) : (
            <Body id="top">
              <ContentHeader>{pageTitle}</ContentHeader>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: () => null,
                  h2: ({ children, ...props }) => {
                    const text = String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    return (
                      <h2 id={id} {...props}>
                        {children}
                      </h2>
                    );
                  },
                  h3: ({ children, ...props }) => {
                    const text = String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    return (
                      <h3 id={id} {...props}>
                        {children}
                      </h3>
                    );
                  },
                  h4: ({ children, ...props }) => {
                    const text = String(children);
                    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    return (
                      <h4 id={id} {...props}>
                        {children}
                      </h4>
                    );
                  },
                }}
              >
                {markdown}
              </ReactMarkdown>
            </Body>
          )}
        </PublicMainGrid>
      </PublicShell>
    </PublicPage>
  );
};

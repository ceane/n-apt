import React, { useState } from "react";
import styled from "styled-components";
import { Link2 } from "lucide-react";

const Button = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: ${(props) => props.theme.textMuted};
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;

  &:hover, &:focus-visible {
    color: ${(props) => props.theme.primary};
    background: ${(props) => props.theme.primaryAnchor};
    opacity: 1 !important;
    outline: none;
  }
`;

export const CopyDeepLinkButton: React.FC<{ title: string; targetPath: string }> = ({ title, targetPath }) => {
  const [copied, setCopied] = useState(false);

  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const url = new URL(targetPath, window.location.origin);
    const value = url.toString();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button className="sidebar-copy-deep-link" type="button" aria-label={`Copy link to ${title}`} title={copied ? "Copied link" : `Copy link to ${title}`} onClick={copy}>
      <Link2 size={14} aria-hidden="true" />
    </Button>
  );
};

import katex from "katex";
import type { Code, Content, Parent } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const LATEX_LANGS = new Set(["latex", "tex"]);

const unwrapDisplayMath = (value: string) => {
  const trimmed = value.trim();

  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) {
    return trimmed.slice(2, -2).trim();
  }

  if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
    return trimmed.slice(2, -2).trim();
  }

  return trimmed;
};

const DISPLAY_SEGMENT_PATTERN = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;

const renderLatexBlock = (value: string) => {
  const matches = Array.from(value.matchAll(DISPLAY_SEGMENT_PATTERN));

  if (matches.length === 0) {
    return katex.renderToString(unwrapDisplayMath(value), {
      throwOnError: false,
      displayMode: true,
      strict: "warn",
    });
  }

  return matches
    .map((match) => {
      const expression = (match[1] ?? match[2] ?? "").trim();

      return katex.renderToString(expression, {
        throwOnError: false,
        displayMode: true,
        strict: "warn",
      });
    })
    .join("");
};

const remarkLatexCodeBlocks: Plugin = () => (tree) => {
  visit(tree, "code", (node: Code, index, parent: Parent | undefined) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const lang = node.lang?.trim().toLowerCase();
    if (!lang || !LATEX_LANGS.has(lang)) {
      return;
    }

    const rendered = renderLatexBlock(node.value);

    const replacement: Content = {
      type: "html",
      value: `<div class="katex-block">${rendered}</div>`,
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
};

export default remarkLatexCodeBlocks;

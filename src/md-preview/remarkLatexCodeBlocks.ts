import type { Code, Content, Parent } from "mdast";
import { visitMdastNodes } from "./visitMdastNodes";

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

const collectExpressions = (value: string) => {
  const matches = Array.from(value.matchAll(DISPLAY_SEGMENT_PATTERN));

  if (matches.length === 0) {
    return [unwrapDisplayMath(value)].filter(Boolean);
  }

  return matches
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter((expression) => expression.length > 0 && !/^\\rule\b/.test(expression));
};

const serializeExpressions = (expressions: string[]) => encodeURIComponent(JSON.stringify(expressions));

const remarkLatexCodeBlocks: Plugin = () => (tree) => {
  visitMdastNodes<Code>(tree, "code", (node: Code, index, parent: Parent) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const lang = node.lang?.trim().toLowerCase();
    if (!lang || !LATEX_LANGS.has(lang)) {
      return;
    }

    const expressions = collectExpressions(node.value);

    const replacement: Content = {
      type: "html",
      value: `<latex-block data-expressions="${serializeExpressions(expressions)}"></latex-block>`,
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
};

export default remarkLatexCodeBlocks;

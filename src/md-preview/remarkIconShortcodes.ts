import type { Plugin } from "unified";
import { getBaseUrl } from "./getBaseUrl";
import type { Content, Parent, Text } from "mdast";
import { visitMdastNodes } from "./visitMdastNodes";

const ICON_PATTERN = /:((?:icon-)?[a-z0-9-]+):/gi;

const createIconNode = (slug: string): Content => ({
  type: "html",
  value: `<icon-inline data-icon="${slug}"></icon-inline>`,
});

const remarkIconShortcodes: Plugin = () => (tree) => {
  visitMdastNodes<Text>(tree, "text", (node: Text, index, parent: Parent) => {
    if (!parent || typeof index !== "number" || !node.value.includes(":")) {
      return;
    }

    const pieces: Content[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    ICON_PATTERN.lastIndex = 0;
    while ((match = ICON_PATTERN.exec(node.value)) !== null) {
      const [full, rawSlug = ""] = match;
      if (match.index > lastIndex) {
        pieces.push({ type: "text", value: node.value.slice(lastIndex, match.index) });
      }

      const normalizedSlug = rawSlug.replace(/^icon-/, "").toLowerCase();
      pieces.push(createIconNode(normalizedSlug));
      lastIndex = match.index + full.length;
    }

    if (!pieces.length) {
      return;
    }

    if (lastIndex < node.value.length) {
      pieces.push({ type: "text", value: node.value.slice(lastIndex) });
    }

    parent.children.splice(index, 1, ...pieces);
    return index + pieces.length;
  });
};

export default remarkIconShortcodes;

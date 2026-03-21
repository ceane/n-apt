import type { Code, Content, Parent } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const BODY_ATTENUATION_LANG = "canvas::bodyattenuation";

const remarkBodyAttenuationBlocks: Plugin = () => (tree) => {
  visit(tree, "code", (node: Code, index, parent: Parent | undefined) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const lang = node.lang?.trim().toLowerCase();
    if (lang !== BODY_ATTENUATION_LANG) {
      return;
    }

    const replacement: Content = {
      type: "html",
      value: "<body-attenuation-canvas></body-attenuation-canvas>",
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
};

export default remarkBodyAttenuationBlocks;

import type { Code, Content, Parent } from "mdast";
import { visitMdastNodes } from "@n-apt/md-preview/utils/visitMdastNodes";

const BODY_ATTENUATION_LANG = "canvas::bodyattenuation";

const remarkBodyAttenuationBlocks: Plugin = (() => (tree: any) => {
  visitMdastNodes<Code>(tree, "code", (node: Code, index, parent: Parent) => {
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
}) as any;

export default remarkBodyAttenuationBlocks;

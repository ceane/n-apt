import type { Code, Content, Parent } from "mdast";
import { visitMdastNodes } from "@n-apt/md-preview/utils/visitMdastNodes";
import type { Plugin } from "unified";

const remarkReactDaysSinceBlocks: Plugin = (() => (tree: any) => {
  visitMdastNodes<Code>(tree, "code", (node: Code, index, parent: Parent) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const langKey = node.lang?.trim().toLowerCase();
    if (langKey !== "react::dayssince") {
      return;
    }

    const replacement: Content = {
      type: "html",
      value: "<days-since></days-since>",
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
}) as any;

export default remarkReactDaysSinceBlocks;

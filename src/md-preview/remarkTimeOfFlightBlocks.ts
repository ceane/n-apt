import type { Code, Content, Parent } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const TIME_OF_FLIGHT_LANG = "canvas::timeofflight";

const remarkTimeOfFlightBlocks: Plugin = () => (tree) => {
  visit(tree, "code", (node: Code, index, parent: Parent | undefined) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const lang = node.lang?.trim().toLowerCase();
    if (lang !== TIME_OF_FLIGHT_LANG) {
      return;
    }

    const replacement: Content = {
      type: "html",
      value: "<time-of-flight-canvas></time-of-flight-canvas>",
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
};

export default remarkTimeOfFlightBlocks;

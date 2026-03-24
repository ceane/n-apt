import type { Code, Content, Parent } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const TIME_OF_FLIGHT_LANG = "canvas::timeofflight";
const IMPEDANCE_LANG = "canvas::impedance";

const CANVAS_TAGS: Record<string, string> = {
  [TIME_OF_FLIGHT_LANG]: "<time-of-flight-canvas></time-of-flight-canvas>",
  [IMPEDANCE_LANG]: "<impedance-canvas></impedance-canvas>",
};

const remarkTimeOfFlightBlocks: Plugin = () => (tree) => {
  visit(tree, "code", (node: Code, index, parent: Parent | undefined) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const lang = node.lang?.trim().toLowerCase();
    if (!lang) {
      return;
    }

    const tag = CANVAS_TAGS[lang];
    if (!tag) {
      return;
    }

    const replacement: Content = {
      type: "html",
      value: tag,
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
};

export default remarkTimeOfFlightBlocks;

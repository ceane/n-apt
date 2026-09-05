import type { Code, Content, Parent } from "mdast";
import type { Plugin } from "unified";

const TIME_OF_FLIGHT_LANG = "canvas::timeofflight";
const IMPEDANCE_LANG = "canvas::impedance";

const CANVAS_TAGS: Record<string, string> = {
  [TIME_OF_FLIGHT_LANG]: "<time-of-flight-canvas></time-of-flight-canvas>",
  [IMPEDANCE_LANG]: "<impedance-canvas></impedance-canvas>",
};

const visitCodeNodes = (
  node: unknown,
  callback: (codeNode: Code, index: number, parent: Parent) => void
) => {
  if (!node || typeof node !== "object") {
    return;
  }

  if ("type" in node && (node as { type?: string }).type === "code") {
    return;
  }

  const parent = node as Parent & { children?: unknown[] };
  const children = parent.children;
  if (!Array.isArray(children)) {
    return;
  }

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child && typeof child === "object" && (child as { type?: string }).type === "code") {
      callback(child as Code, index, parent);
      continue;
    }

    visitCodeNodes(child, callback);
  }
};

const remarkTimeOfFlightBlocks: Plugin = () => (tree) => {
  visitCodeNodes(tree, (node: Code, index, parent: Parent) => {
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

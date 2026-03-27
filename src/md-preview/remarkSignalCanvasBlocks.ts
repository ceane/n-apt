import type { Code, Content, Parent } from "mdast";
import type { Plugin } from "unified";
import { visitMdastNodes } from "./visitMdastNodes";

const SIGNAL_TAGS: Record<string, string> = {
  "canvas::phaseshifting": "<phase-shifting-canvas></phase-shifting-canvas>",
  "canvas::frequencymodulation": "<frequency-modulation-canvas></frequency-modulation-canvas>",
  "canvas::amplitudemodulation": "<amplitude-modulation-canvas></amplitude-modulation-canvas>",
  "canvas::multipath": "<multipath-canvas></multipath-canvas>",
  "canvas::heterodyning": "<heterodyning-canvas></heterodyning-canvas>",
};

const remarkSignalCanvasBlocks: Plugin = () => (tree) => {
  visitMdastNodes<Code>(tree, "code", (node: Code, index, parent: Parent) => {
    if (!parent || typeof index !== "number") {
      return;
    }

    const langKey = node.lang?.trim().toLowerCase();
    if (!langKey) {
      return;
    }

    const value = SIGNAL_TAGS[langKey];
    if (!value) {
      return;
    }

    const replacement: Content = {
      type: "html",
      value,
    };

    parent.children.splice(index, 1, replacement);
    return index + 1;
  });
};

export default remarkSignalCanvasBlocks;

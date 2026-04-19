import type { Code, Content, Parent } from "mdast";
import { visitMdastNodes } from "@n-apt/md-preview/utils/visitMdastNodes";

const SIGNAL_TAGS: Record<string, string> = {
  "canvas::phaseshifting": "<phase-shifting-canvas></phase-shifting-canvas>",
  "canvas::frequencymodulation": "<frequency-modulation-canvas></frequency-modulation-canvas>",
  "canvas::amplitudemodulation": "<amplitude-modulation-canvas></amplitude-modulation-canvas>",
  "canvas::multipath": "<multipath-canvas></multipath-canvas>",
  "canvas::heterodyning": "<heterodyning-canvas></heterodyning-canvas>",
  "canvas::endpointrange": "<endpoint-range-canvas></endpoint-range-canvas>",
};

const remarkSignalCanvasBlocks: Plugin = (() => (tree: any) => {
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
}) as any;

export default remarkSignalCanvasBlocks;

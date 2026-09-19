import { defaultSchema } from "rehype-sanitize";
import rehypeSanitize from "rehype-sanitize";
import type { Root, Element } from "hast";
import type { Plugin } from "unified";

const articleAnchorIds = new Set([
  "table-of-contents", "theory-1", "theory-2", "theory-3", "multipath",
  "hypothesis-post-sdr", "brainwaves", "channels", "freq-mod", "amp-mod",
  "heterodyning", "phase-shifting", "aperture", "power", "center-frequency",
  "impedance", "body-attenuation", "features", "n-apt-in-the-wild", "n-apt-form",
  "data-estimate", "conclusion", "vocab", "tdlr",
]);

const footnoteIdRegex = /^fn(?:ref)?-/;

export const articleSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: [
    ...defaultSchema.tagNames ?? [],
    "small",
    "latex-block", "icon-inline", "days-since", "desktop-only", "mobile-only",
    "body-attenuation-canvas", "impedance-canvas", "time-of-flight-canvas",
    "phase-shifting-canvas", "frequency-modulation-canvas", "amplitude-modulation-canvas",
    "multipath-canvas", "heterodyning-canvas", "endpoint-range-canvas",
    "triangulation-map-canvas", "triangulation-close-enough-canvas", "hero-ascii-canvas",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      "id", "title", "lang", "dir",
      "dataFootnoteRef", "dataFootnoteBackref", "dataFootnotes",
      ["className", "sr-only", "footnotes"],
    ],
    a: [...defaultSchema.attributes?.a ?? [], "target", "rel"],
    code: [["className", /^language-./, "math-inline", "math-display"]],
    span: [["className", "dropcap", "math-inline", "math-display"]],
    div: [
      ["className", "street-sign-collage", "table-tiny", "table-dense", "estimated-data-table"],
      ["role", "group"], "ariaLabel",
      ["dataChannelA", "2col,2row"], ["dataChannelB", "2col,2row"], ["dataChannelC", "2col,2row"],
      ["dataDataEstimate", "network", "in-air", "in-person"],
    ],
    img: [...defaultSchema.attributes?.img ?? [], "alt", "width", "height", ["loading", "lazy", "eager"], ["decoding", "async", "sync", "auto"]],
    td: ["align", "colSpan", "rowSpan"],
    th: ["align", "colSpan", "rowSpan", "scope"],
    details: ["open"],
    "latex-block": ["dataExpressions"],
    "icon-inline": ["dataIcon"],
  },
};

export const rehypeArticleAnchors: Plugin<[], Root> = () => (tree) => {
  const visit = (node: Root | Element) => {
    if (node.type === "element") {
      const id = node.properties.id;
      if (typeof id === "string" && id.startsWith("user-content-")) {
        const original = id.slice("user-content-".length);
        if (articleAnchorIds.has(original) || footnoteIdRegex.test(original)) {
          node.properties.id = original;
        }
      }
    }
    for (const child of node.children) {
      if (child.type === "element") visit(child);
    }
  };
  visit(tree);
};

export const rehypeSanitizeArticle: Plugin<[], Root> = () =>
  rehypeSanitize(articleSanitizeSchema);

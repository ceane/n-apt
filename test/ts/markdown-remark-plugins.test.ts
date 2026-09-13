import remarkBodyAttenuationBlocks from "@n-apt/app-article/utils/remarkBodyAttenuationBlocks";
import remarkTimeOfFlightBlocks from "@n-apt/app-article/utils/remarkTimeOfFlightBlocks";
import remarkSignalCanvasBlocks from "@n-apt/app-article/utils/remarkSignalCanvasBlocks";
import remarkLatexCodeBlocks from "@n-apt/app-article/utils/remarkLatexCodeBlocks";
import remarkIconShortcodes from "@n-apt/app-article/utils/remarkIconShortcodes";

const applyPlugin = (plugin: any, tree: any) => {
  if (plugin) {
    plugin(tree);
  }
  return tree;
};

describe("Markdown Remark Plugins", () => {
  describe("Body Attenuation Plugin", () => {
    test("converts body attenuation code blocks to HTML", () => {
      const tree = {
        type: "root",
        children: [
          { type: "code", lang: "canvas::bodyattenuation", value: "" },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkBodyAttenuationBlocks(), tree);

      expect(tree.children[0]).toEqual({
        type: "html",
        value: "<body-attenuation-canvas></body-attenuation-canvas>",
      });
    });

    test("ignores unrelated code blocks", () => {
      const tree = {
        type: "root",
        children: [
          { type: "code", lang: "javascript", value: 'console.log("hello");' },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkBodyAttenuationBlocks(), tree);

      expect(tree.children[0]).toEqual({
        type: "code",
        lang: "javascript",
        value: 'console.log("hello");',
      });
    });
  });

  describe("Time of Flight Plugin", () => {
    test("converts time of flight code blocks to HTML", () => {
      const tree = {
        type: "root",
        children: [{ type: "code", lang: "canvas::timeofflight", value: "" }],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkTimeOfFlightBlocks(), tree);

      expect(tree.children[0]).toEqual({
        type: "html",
        value: "<time-of-flight-canvas></time-of-flight-canvas>",
      });
    });
  });

  describe("Signal Canvas Plugin", () => {
    test("converts amplitude modulation blocks to HTML", () => {
      const tree = {
        type: "root",
        children: [
          { type: "code", lang: "canvas::amplitudemodulation", value: "" },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkSignalCanvasBlocks(), tree);

      expect(tree.children[0]).toEqual({
        type: "html",
        value: "<amplitude-modulation-canvas></amplitude-modulation-canvas>",
      });
    });

    test("handles multiple signal canvas types", () => {
      const tree = {
        type: "root",
        children: [
          { type: "code", lang: "canvas::frequencymodulation", value: "" },
          { type: "code", lang: "canvas::heterodyning", value: "" },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkSignalCanvasBlocks(), tree);

      expect(tree.children[0]).toEqual({
        type: "html",
        value: "<frequency-modulation-canvas></frequency-modulation-canvas>",
      });
      expect(tree.children[1]).toEqual({
        type: "html",
        value: "<heterodyning-canvas></heterodyning-canvas>",
      });
    });
  });

  describe("LaTeX Plugin", () => {
    test("converts LaTeX code blocks to HTML", () => {
      const tree = {
        type: "root",
        children: [
          { type: "code", lang: "latex", value: "\\[\nE = mc^2\n\\]" },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkLatexCodeBlocks(), tree);

      expect(tree.children[0]).toEqual({
        type: "html",
        value:
          '<latex-block data-expressions="%5B%22E%20%3D%20mc%5E2%22%5D"></latex-block>',
      });
    });

    test("collects multiple LaTeX expressions and strips rule expressions", () => {
      const tree = {
        type: "root",
        children: [
          {
            type: "code",
            lang: "latex",
            value:
              "$$\\alpha + \\beta = \\gamma$$\n\n$$\\rule{1em}{1em}$$\n\n$$\\sin^2(\\theta) + \\cos^2(\\theta) = 1$$",
          },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkLatexCodeBlocks(), tree);

      const serialized = (tree.children[0].value as string).match(
        /data-expressions="([^"]+)"/,
      )?.[1];
      expect(serialized).toBeTruthy();
      expect(JSON.parse(decodeURIComponent(serialized!))).toEqual([
        "\\alpha + \\beta = \\gamma",
        "\\sin^2(\\theta) + \\cos^2(\\theta) = 1",
      ]);
    });
  });

  describe("Icon Shortcodes Plugin", () => {
    test("converts icon shortcodes to icon-inline nodes", () => {
      const tree = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: ":heart: :star: :check:" }],
          },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkIconShortcodes(), tree);

      expect(tree.children[0].children).toEqual([
        {
          type: "html",
          value: '<icon-inline data-icon="heart"></icon-inline>',
        },
        { type: "text", value: " " },
        { type: "html", value: '<icon-inline data-icon="star"></icon-inline>' },
        { type: "text", value: " " },
        {
          type: "html",
          value: '<icon-inline data-icon="check"></icon-inline>',
        },
      ]);
    });

    test("converts any matching shortcode-like text into icon-inline nodes", () => {
      const tree = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "This is not a shortcode: :invalidicon:" },
            ],
          },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkIconShortcodes(), tree);

      expect(tree.children[0].children).toEqual([
        { type: "text", value: "This is not a shortcode: " },
        {
          type: "html",
          value: '<icon-inline data-icon="invalidicon"></icon-inline>',
        },
      ]);
    });
  });

  describe("Plugin Integration", () => {
    test("handles multiple plugin types in one document", () => {
      const tree = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Here's an icon: :heart:" }],
          },
          { type: "code", lang: "canvas::bodyattenuation", value: "" },
          {
            type: "code",
            lang: "latex",
            value:
              "\\[\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\epsilon_0}\\]",
          },
          { type: "code", lang: "canvas::amplitudemodulation", value: "" },
        ],
      };

      // @ts-ignore - remark plugin type signature is complex for tests
      applyPlugin(remarkIconShortcodes(), tree);
      // @ts-ignore
      applyPlugin(remarkBodyAttenuationBlocks(), tree);
      // @ts-ignore
      applyPlugin(remarkLatexCodeBlocks(), tree);
      // @ts-ignore
      applyPlugin(remarkSignalCanvasBlocks(), tree);

      expect((tree.children[0] as any).children[1]).toEqual({
        type: "html",
        value: '<icon-inline data-icon="heart"></icon-inline>',
      });
      expect(tree.children[1] as any).toEqual({
        type: "html",
        value: "<body-attenuation-canvas></body-attenuation-canvas>",
      });
      expect((tree.children[2] as any).type).toBe("html");
      expect((tree.children[2] as any).value).toContain("<latex-block");
      expect(tree.children[3]).toEqual({
        type: "html",
        value: "<amplitude-modulation-canvas></amplitude-modulation-canvas>",
      });
    });
  });
});

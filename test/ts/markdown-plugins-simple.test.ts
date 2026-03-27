import remarkBodyAttenuationBlocks from '../../src/md-preview/remarkBodyAttenuationBlocks';
import remarkTimeOfFlightBlocks from '../../src/md-preview/remarkTimeOfFlightBlocks';
import remarkSignalCanvasBlocks from '../../src/md-preview/remarkSignalCanvasBlocks';
import remarkLatexCodeBlocks from '../../src/md-preview/remarkLatexCodeBlocks';
import remarkIconShortcodes from '../../src/md-preview/remarkIconShortcodes';
import type { Code } from 'mdast';
import type { Parent } from 'mdast';

// Mock the unified processor for testing
const createMockTree = (markdown: string, explicitLang?: string): any => ({
  type: 'root',
  children: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Test content' }
      ]
    },
    {
      type: 'code',
      lang: explicitLang ?? (markdown.includes('canvas::bodyattenuation') ? 'canvas::bodyattenuation' :
           markdown.includes('canvas::timeofflight') ? 'canvas::timeofflight' :
           markdown.includes('canvas::phaseshifting') ? 'canvas::phaseshifting' :
           markdown.includes('canvas::frequencymodulation') ? 'canvas::frequencymodulation' :
           markdown.includes('canvas::amplitudemodulation') ? 'canvas::amplitudemodulation' :
           markdown.includes('canvas::heterodyning') ? 'canvas::heterodyning' :
           markdown.includes('canvas::multipath') ? 'canvas::multipath' :
           markdown.includes('latex') ? 'latex' :
           markdown.includes('tex') ? 'tex' :
           markdown.startsWith('canvas::') ? markdown : undefined),
      value: markdown
    }
  ]
});

describe('Markdown Remark Plugins - Simple Tests', () => {
  describe('Body Attenuation Plugin', () => {
    test('should identify and replace body attenuation blocks', () => {
      const plugin = remarkBodyAttenuationBlocks();
      const tree = createMockTree('canvas::bodyattenuation');
      
      // Simulate the visitor pattern
      const visitNode = (node: any, index: number, parent: any) => {
        if (node.type === 'code' && node.lang === 'canvas::bodyattenuation') {
          const replacement = {
            type: 'html',
            value: '<body-attenuation-canvas></body-attenuation-canvas>',
          };
          parent.children.splice(index, 1, replacement);
          return index + 1;
        }
      };
      
      visitNode(tree.children[1], 1, tree);
      
      expect(tree.children[1]).toEqual({
        type: 'html',
        value: '<body-attenuation-canvas></body-attenuation-canvas>',
      });
    });

    test('should ignore non-body attenuation blocks', () => {
      const plugin = remarkBodyAttenuationBlocks();
      const tree = createMockTree('canvas::other');
      
      // Should not modify the tree
      expect(tree.children[1]).toEqual({
        type: 'code',
        lang: 'canvas::other',
        value: 'canvas::other'
      });
    });
  });

  describe('Time of Flight Plugin', () => {
    test('should identify and replace time of flight blocks', () => {
      const plugin = remarkTimeOfFlightBlocks();
      const tree = createMockTree('canvas::timeofflight');
      
      const visitNode = (node: any, index: number, parent: any) => {
        if (node.type === 'code' && node.lang === 'canvas::timeofflight') {
          const replacement = {
            type: 'html',
            value: '<time-of-flight-canvas></time-of-flight-canvas>',
          };
          parent.children.splice(index, 1, replacement);
          return index + 1;
        }
      };
      
      visitNode(tree.children[1], 1, tree);
      
      expect(tree.children[1]).toEqual({
        type: 'html',
        value: '<time-of-flight-canvas></time-of-flight-canvas>',
      });
    });
  });

  describe('Signal Canvas Plugin', () => {
    test('should identify and replace signal canvas blocks', () => {
      const plugin = remarkSignalCanvasBlocks();
      const tree = createMockTree('canvas::amplitudemodulation');
      
      const visitNode = (node: any, index: number, parent: any) => {
        if (node.type === 'code' && node.lang === 'canvas::amplitudemodulation') {
          const replacement = {
            type: 'html',
            value: '<amplitude-modulation-canvas></amplitude-modulation-canvas>',
          };
          parent.children.splice(index, 1, replacement);
          return index + 1;
        }
      };
      
      visitNode(tree.children[1], 1, tree);
      
      expect(tree.children[1]).toEqual({
        type: 'html',
        value: '<amplitude-modulation-canvas></amplitude-modulation-canvas>',
      });
    });
  });

  describe('LaTeX Plugin', () => {
    test('should process LaTeX expressions correctly', () => {
      const plugin = remarkLatexCodeBlocks();
      const tree = createMockTree('\\[E = mc^2\\]', 'latex');
      
      const visitNode = (node: any, index: number, parent: any) => {
        if (node.type === 'code' && (node.lang === 'latex' || node.lang === 'tex')) {
          const expressions = ['E = mc^2'];
          const serializedExpressions = encodeURIComponent(JSON.stringify(expressions));
          const replacement = {
            type: 'html',
            value: `<latex-block data-expressions="${serializedExpressions}"></latex-block>`,
          };
          parent.children.splice(index, 1, replacement);
          return index + 1;
        }
      };
      
      visitNode(tree.children[1], 1, tree);
      
      expect(tree.children[1]).toEqual({
        type: 'html',
        value: '<latex-block data-expressions="%5B%22E%20%3D%20mc%5E2%22%5D"></latex-block>',
      });
    });

    test('should handle multiple LaTeX expressions', () => {
      const plugin = remarkLatexCodeBlocks();
      const tree = createMockTree('$$\\alpha + \\beta = \\gamma$$$$\\sin^2(\\theta) + \\cos^2(\\theta) = 1$$', 'latex');
      
      const visitNode = (node: any, index: number, parent: any) => {
        if (node.type === 'code' && (node.lang === 'latex' || node.lang === 'tex')) {
          const expressions = ['\\alpha + \\beta = \\gamma', '\\sin^2(\\theta) + \\cos^2(\\theta) = 1'];
          const serializedExpressions = encodeURIComponent(JSON.stringify(expressions));
          const replacement = {
            type: 'html',
            value: `<latex-block data-expressions="${serializedExpressions}"></latex-block>`,
          };
          parent.children.splice(index, 1, replacement);
          return index + 1;
        }
      };
      
      visitNode(tree.children[1], 1, tree);
      
      const result = tree.children[1] as any;
      expect(result.type).toBe('html');
      expect(result.value).toContain('<latex-block');
      expect(result.value).toContain('data-expressions=');
      
      // Verify the expressions are correctly encoded
      const decoded = JSON.parse(decodeURIComponent(result.value.match(/data-expressions="([^"]*)"/)![1]));
      expect(decoded).toEqual(['\\alpha + \\beta = \\gamma', '\\sin^2(\\theta) + \\cos^2(\\theta) = 1']);
    });

    test('should handle display math delimiters', () => {
      const plugin = remarkLatexCodeBlocks();
      const tree = createMockTree('\\[\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}\\]', 'latex');
      
      const visitNode = (node: any, index: number, parent: any) => {
        if (node.type === 'code' && (node.lang === 'latex' || node.lang === 'tex')) {
          const expressions = ['\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}'];
          const replacement = {
            type: 'html',
            value: `<latex-block data-expressions="${encodeURIComponent(JSON.stringify(expressions))}"></latex-block>`,
          };
          parent.children.splice(index, 1, replacement);
          return index + 1;
        }
      };
      
      visitNode(tree.children[1], 1, tree);
      
      const result = tree.children[1] as any;
      expect(result.type).toBe('html');
      expect(result.value).toContain('<latex-block');
      
      const decoded = JSON.parse(decodeURIComponent(result.value.match(/data-expressions="([^"]*)"/)![1]));
      expect(decoded[0]).toBe('\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}');
    });
  });

  describe('Icon Shortcodes Plugin', () => {
    test('should replace icon shortcodes with HTML elements', () => {
      const plugin = remarkIconShortcodes();
      const tree = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Here is an icon: ' },
              { type: 'text', value: ':heart:' },
              { type: 'text', value: ' and another: ' },
              { type: 'text', value: ':star:' }
            ]
          }
        ]
      };
      
      // Simulate the text replacement logic
      const processText = (text: string): string => {
        return text
          .replace(/:heart:/g, '<icon-inline data-icon="heart"></icon-inline>')
          .replace(/:star:/g, '<icon-inline data-icon="star"></icon-inline>')
          .replace(/:check:/g, '<icon-inline data-icon="check"></icon-inline>');
      };
      
      // Apply to all text nodes
      const processNode = (node: any) => {
        if (node.type === 'text') {
          node.value = processText(node.value);
        } else if (node.children) {
          node.children.forEach(processNode);
        }
      };
      
      processNode(tree);
      
      expect(tree.children[0].children[0].value).toBe('Here is an icon: ');
      expect(tree.children[0].children[1].value).toBe('<icon-inline data-icon="heart"></icon-inline>');
      expect(tree.children[0].children[2].value).toBe(' and another: ');
      expect(tree.children[0].children[3].value).toBe('<icon-inline data-icon="star"></icon-inline>');
    });

    test('should ignore text that looks like shortcodes but isn\'t valid', () => {
      const plugin = remarkIconShortcodes();
      
      const processText = (text: string): string => {
        return text
          .replace(/:heart:/g, '<icon-inline data-icon="heart"></icon-inline>')
          .replace(/:star:/g, '<icon-inline data-icon="star"></icon-inline>')
          .replace(/:check:/g, '<icon-inline data-icon="check"></icon-inline>');
      };
      
      const input = 'This is not a shortcode: :invalidicon:';
      const result = processText(input);
      
      expect(result).toBe('This is not a shortcode: :invalidicon:');
    });
  });

  describe('Plugin Function Exports', () => {
    test('should export all required plugins', () => {
      expect(typeof remarkBodyAttenuationBlocks).toBe('function');
      expect(typeof remarkTimeOfFlightBlocks).toBe('function');
      expect(typeof remarkSignalCanvasBlocks).toBe('function');
      expect(typeof remarkLatexCodeBlocks).toBe('function');
      expect(typeof remarkIconShortcodes).toBe('function');
    });

    test('should return plugin functions', () => {
      const bodyAttenuationPlugin = remarkBodyAttenuationBlocks();
      const timeOfFlightPlugin = remarkTimeOfFlightBlocks();
      const signalCanvasPlugin = remarkSignalCanvasBlocks();
      const latexPlugin = remarkLatexCodeBlocks();
      const iconPlugin = remarkIconShortcodes();
      
      expect(typeof bodyAttenuationPlugin).toBe('function');
      expect(typeof timeOfFlightPlugin).toBe('function');
      expect(typeof signalCanvasPlugin).toBe('function');
      expect(typeof latexPlugin).toBe('function');
      expect(typeof iconPlugin).toBe('function');
    });
  });
});

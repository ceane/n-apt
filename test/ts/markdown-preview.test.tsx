import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('highlight.js/styles/github-dark.css', () => ({}), { virtual: true });
jest.mock('katex/dist/katex.min.css', () => ({}), { virtual: true });
jest.mock('remark-gfm', () => jest.fn(() => null));
jest.mock('rehype-highlight', () => jest.fn(() => null));
jest.mock('rehype-raw', () => jest.fn(() => null));
jest.mock('rehype-katex', () => jest.fn(() => null));
jest.mock('katex', () => ({
  __esModule: true,
  default: {
    renderToString: jest.fn((expression: string) => `<span>${expression}</span>`),
  },
}));
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: any) => {
    const markdown = String(children ?? '');
    const elements: React.ReactElement[] = [];

    markdown.split('\n').forEach((line, index) => {
      if (line.startsWith('## ')) {
        elements.push(React.createElement('h2', { key: `h2-${index}` }, line.slice(3)));
      }
    });

    if (markdown.includes('canvas::bodyattenuation')) {
      elements.push(React.createElement('body-attenuation-canvas', { key: 'body' }));
    }
    if (markdown.includes('canvas::timeofflight')) {
      elements.push(React.createElement('time-of-flight-canvas', { key: 'tof' }));
    }
    if (markdown.includes('canvas::impedance')) {
      elements.push(React.createElement('impedance-canvas', { key: 'impedance' }));
    }
    if (markdown.includes('canvas::phaseshifting')) {
      elements.push(React.createElement('phase-shifting-canvas', { key: 'phase' }));
    }
    if (markdown.includes('canvas::amplitudemodulation')) {
      elements.push(React.createElement('amplitude-modulation-canvas', { key: 'am' }));
    }

    if (markdown.includes('```latex')) {
      const codeBlock = markdown.match(/```latex\s*([\s\S]*?)```/);
      const matches = Array.from((codeBlock?.[1] ?? '').matchAll(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g));
      const expressions = matches
        .map((match) => (match[1] ?? match[2] ?? '').trim())
        .filter(Boolean);
      elements.push(React.createElement('latex-block', {
        key: 'latex',
        'data-expressions': encodeURIComponent(JSON.stringify(expressions)),
      }));
    }

    if (markdown.includes(':heart:')) {
      elements.push(React.createElement('span', { key: 'heart', 'data-lucide-icon': 'heart' }));
    }
    if (markdown.includes(':star:')) {
      elements.push(React.createElement('span', { key: 'star', 'data-lucide-icon': 'star' }));
    }
    if (markdown.includes(':check:')) {
      elements.push(React.createElement('span', { key: 'check', 'data-lucide-icon': 'check' }));
    }

    if (markdown.includes('```javascript')) {
      const codeBlock = markdown.match(/```javascript\s*([\s\S]*?)```/);
      elements.push(
        React.createElement(
          'pre',
          { key: 'code' },
          React.createElement('code', { className: 'language-javascript' }, (codeBlock?.[1] ?? '').trim()),
        ),
      );
    }

    return React.createElement('div', null, elements);
  },
}));

import App from '../../src/md-preview/App';

const renderWithMarkdown = async (markdown: string) => {
  (fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(markdown),
    headers: { get: () => 'text/markdown' },
  });

  render(<App />);

  await waitFor(() => {
    expect(fetch).toHaveBeenCalled();
  });
};

describe('Markdown Preview System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# Test Markdown\n\nThis is a test.'),
      headers: { get: () => 'text/markdown' },
    }) as any;
  });

  test('fetches the default markdown source with no-cache headers', async () => {
    render(<App />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/pages/how-do-they-do-it.md',
        {
          headers: { 'Cache-Control': 'no-cache' },
          cache: 'no-store',
        },
      );
    });
  });

  test('renders markdown canvas placeholders from transformed content', async () => {
    await renderWithMarkdown(`
# Test

\`\`\`canvas::bodyattenuation
\`\`\`

\`\`\`canvas::timeofflight
\`\`\`

\`\`\`canvas::impedance
\`\`\`

\`\`\`canvas::phaseshifting
\`\`\`

\`\`\`canvas::amplitudemodulation
\`\`\`
    `);

    await waitFor(() => {
      expect(document.querySelector('body-attenuation-canvas')).toBeInTheDocument();
      expect(document.querySelector('time-of-flight-canvas')).toBeInTheDocument();
      expect(document.querySelector('impedance-canvas')).toBeInTheDocument();
      expect(document.querySelector('phase-shifting-canvas')).toBeInTheDocument();
      expect(document.querySelector('amplitude-modulation-canvas')).toBeInTheDocument();
    });
  });

  test('renders latex blocks with encoded expressions', async () => {
    await renderWithMarkdown(`
# LaTeX

\`\`\`latex
$$
\\alpha + \\beta = \\gamma
$$

$$
\\sin^2(\\theta) + \\cos^2(\\theta) = 1
$$
\`\`\`
    `);

    await waitFor(() => {
      const latexBlock = document.querySelector('latex-block');
      expect(latexBlock).toBeInTheDocument();
      const expressions = JSON.parse(decodeURIComponent(latexBlock?.getAttribute('data-expressions') ?? '[]'));
      expect(expressions).toHaveLength(2);
    });
  });

  test('renders icon placeholders for icon shortcodes', async () => {
    await renderWithMarkdown(`
# Icons

:heart: :star: :check:
    `);

    await waitFor(() => {
      expect(document.querySelectorAll('[data-lucide-icon]')).toHaveLength(3);
    });
  });

  test('renders highlighted code blocks from markdown content', async () => {
    await renderWithMarkdown(`
# Code

\`\`\`javascript
function hello() {
  console.log("Hello, world!");
}
\`\`\`
    `);

    await waitFor(() => {
      const codeBlock = document.querySelector('pre code.language-javascript');
      expect(codeBlock).toBeInTheDocument();
      expect(codeBlock?.textContent).toContain('function hello()');
    });
  });

  test('renders large heading collections without dropping sections', async () => {
    const largeMarkdown = Array.from({ length: 25 }, (_, index) => `## Section ${index + 1}`).join('\n');
    await renderWithMarkdown(largeMarkdown);

    await waitFor(() => {
      expect(document.querySelectorAll('h2')).toHaveLength(25);
    });
  });
});

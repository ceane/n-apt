import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";
import rust from "highlight.js/lib/languages/rust";

const registerLanguage = (name: string, language: (hljs?: typeof import("highlight.js")) => any) => {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
};

registerLanguage("javascript", javascript);
registerLanguage("js", javascript);
registerLanguage("typescript", typescript);
registerLanguage("ts", typescript);
registerLanguage("json", json);
registerLanguage("bash", bash);
registerLanguage("shell", bash);
registerLanguage("md", markdown);
registerLanguage("markdown", markdown);
registerLanguage("rust", rust);
registerLanguage("rs", rust);

const BLEND_IMAGE_PATTERNS = ["bart-line-drawing", "first-installment-nsa"];
const HERO_IMAGE_PATTERNS = ["hero-light", "hero-dark"];

const renderer = new marked.Renderer();
renderer.image = ({ href, text, title }) => {
  const normalizedHref = href.toLowerCase();
  const normalizedText = text.toLowerCase();
  
  const shouldBlend = BLEND_IMAGE_PATTERNS.some((pattern) =>
    normalizedHref.includes(pattern) || normalizedText.includes(pattern)
  );

  const isHero = HERO_IMAGE_PATTERNS.some((pattern) =>
    normalizedHref.includes(pattern) || normalizedText.includes(pattern)
  );

  let className = "markdown-figure";
  if (shouldBlend) className += " blend-image";
  if (isHero) className += " hero-image";

  return `<figure class="${className}"><img src="${href}" alt="${text}" ${title ? `title="${title}"` : ""}></figure>`;
};

marked.use(
  { renderer },
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }

      return hljs.highlightAuto(code).value;
    },
  }),
);

marked.setOptions({
  gfm: true,
  breaks: false,
  mangle: false,
  headerIds: true,
});

export interface MarkdownRendererOptions {
  target: HTMLElement;
  source: string;
  spinnerTemplate?: HTMLTemplateElement | null;
}

export class MarkdownRenderer {
  #target: HTMLElement;
  #source: string;
  #spinnerTemplate: HTMLTemplateElement | null | undefined;
  #spinnerElement: HTMLElement | null = null;

  constructor({ target, source, spinnerTemplate }: MarkdownRendererOptions) {
    if (!target) {
      throw new Error("MarkdownRenderer requires a target element");
    }

    this.#target = target;
    this.#source = source;
    this.#spinnerTemplate = spinnerTemplate;
  }

  async render() {
    this.#setLoading(true);

    try {
      const response = await fetch(this.#source, {
        headers: { "Cache-Control": "no-cache" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch markdown: ${response.status} ${response.statusText}`);
      }

      const markdownText = await response.text();
      const html = marked.parse(markdownText);

      this.#target.innerHTML = html;
      this.#target.classList.add("markdown-ready");
      this.#announce(`Rendered ${new URL(this.#source, window.location.href).pathname}`);
    } catch (error) {
      console.error(error);
      this.#target.innerHTML = `
        <section class="markdown-error" role="alert">
          <h2>Could not load markdown</h2>
          <p>${(error as Error).message}</p>
          <p><code>${this.#source}</code></p>
        </section>`;
    } finally {
      this.#setLoading(false);
    }
  }

  updateSource(nextSource: string) {
    this.#source = nextSource;
    return this.render();
  }

  #setLoading(isLoading: boolean) {
    if (!this.#spinnerTemplate) {
      return;
    }

    if (isLoading) {
      if (!this.#spinnerElement) {
        const fragment = this.#spinnerTemplate.content.cloneNode(true);
        this.#target.replaceChildren(fragment);
        this.#spinnerElement = this.#target.firstElementChild as HTMLElement;
      }
      return;
    }

    if (this.#spinnerElement) {
      this.#spinnerElement = null;
    }
  }

  #announce(message: string) {
    if (!message) return;
    const liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("role", "status");
    liveRegion.className = "sr-only";
    liveRegion.textContent = message;
    document.body.appendChild(liveRegion);
    setTimeout(() => liveRegion.remove(), 1200);
  }
}

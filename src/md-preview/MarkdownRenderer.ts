const BLEND_IMAGE_PATTERNS = ["bart-line-drawing", "first-installment-nsa"];
const HERO_IMAGE_PATTERNS = ["hero-light", "hero-dark"];

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderMarkdownToHtml = (markdownText: string) => {
  const lines = markdownText.split(/\r?\n/);
  const html: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const flushParagraph = (paragraph: string[]) => {
    if (paragraph.length === 0) return;
    html.push(`<p>${paragraph.map(escapeHtml).join("<br>")}</p>`);
  };

  let paragraph: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
        codeBuffer = [];
      } else {
        flushParagraph(paragraph);
        paragraph = [];
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph(paragraph);
      paragraph = [];
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph(paragraph);
      paragraph = [];
      const level = headingMatch[1].length;
      html.push(`<h${level} id="${escapeHtml(headingMatch[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}">${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith("![](") || trimmed.startsWith("![")) {
      flushParagraph(paragraph);
      paragraph = [];
      const match = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
      if (match) {
        const [, alt, href] = match;
        const normalizedHref = href.toLowerCase();
        const normalizedAlt = alt.toLowerCase();
        const shouldBlend = BLEND_IMAGE_PATTERNS.some((pattern) =>
          normalizedHref.includes(pattern) || normalizedAlt.includes(pattern)
        );
        const isHero = HERO_IMAGE_PATTERNS.some((pattern) =>
          normalizedHref.includes(pattern) || normalizedAlt.includes(pattern)
        );
        const className = ["markdown-figure", shouldBlend ? "blend-image" : null, isHero ? "hero-image" : null]
          .filter(Boolean)
          .join(" ");
        html.push(`<figure class="${className}"><img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"></figure>`);
      }
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph(paragraph);
  if (codeBuffer.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
};

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

  async render(): Promise<void> {
    this.#setLoading(true);

    try {
      const response = await fetch(this.#source, {
        headers: { "Cache-Control": "no-cache" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch markdown: ${response.status} ${response.statusText}`);
      }

      const markdownText = await response.text();
      const html = renderMarkdownToHtml(markdownText);

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

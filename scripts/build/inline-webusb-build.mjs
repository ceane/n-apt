import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const distRoot = path.join(projectRoot, "dist-webusb");
const assetsRoot = path.join(distRoot, "assets");

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function minifyHtml(html) {
  const preservedBlocks = [];
  const withPreservedBlocks = html.replace(
    /<(script|style|pre|textarea)\b[\s\S]*?<\/\1>/gi,
    (block) => {
      const token = `___N_APT_PRESERVED_${preservedBlocks.length}___`;
      preservedBlocks.push(block);
      return token;
    },
  );
  let minified = withPreservedBlocks
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
  preservedBlocks.forEach((block, index) => {
    minified = minified.replace(
      `___N_APT_PRESERVED_${index}___`,
      block,
    );
  });
  return minified;
}

function getAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"),
  );
  return match?.[2] ?? null;
}

function resolveBuiltAsset(assetUrl, htmlPath) {
  const cleanUrl = assetUrl.split(/[?#]/, 1)[0];
  return cleanUrl.startsWith("/")
    ? path.join(distRoot, cleanUrl.slice(1))
    : path.resolve(path.dirname(htmlPath), cleanUrl);
}

async function bundleBuiltScript(assetUrl, htmlPath) {
  const entryPath = resolveBuiltAsset(assetUrl, htmlPath);
  const result = await bundle({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    target: "es2020",
    legalComments: "none",
    write: false,
  });
  return result.outputFiles[0].text.trim();
}

async function inlineScripts(html, htmlPath) {
  const scriptPattern =
    /<script\b([^>]*)\bsrc=(['"])([^'"]+)\2[^>]*><\/script>/gi;
  const matches = [...html.matchAll(scriptPattern)];
  for (const match of matches) {
    const script = await bundleBuiltScript(match[3], htmlPath);
    const htmlSafeScript = script.replace(/<\/script/gi, "<\\/script");
    html = html.replace(
      match[0],
      () => `<script type="module">${htmlSafeScript}</script>`,
    );
  }
  return html.replace(
    /<link\b[^>]*\brel=(['"])modulepreload\1[^>]*>/gi,
    "",
  );
}

async function inlineStyles(html, htmlPath) {
  const stylesheetPattern = /<link\b([^>]*)>/gi;
  const matches = [...html.matchAll(stylesheetPattern)];
  for (const match of matches) {
    const attributes = match[1];
    const rel = getAttribute(attributes, "rel");
    const href = getAttribute(attributes, "href");
    if (rel?.toLowerCase() !== "stylesheet" || !href) continue;
    const stylesheet = await fs.readFile(
      resolveBuiltAsset(href, htmlPath),
      "utf8",
    );
    html = html.replace(
      match[0],
      () => `<style>${minifyCss(stylesheet)}</style>`,
    );
  }
  return html;
}

async function findHtmlFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function inlineBuild() {
  const htmlFiles = await findHtmlFiles(distRoot);
  for (const htmlPath of htmlFiles) {
    let html = await fs.readFile(htmlPath, "utf8");
    html = await inlineScripts(html, htmlPath);
    html = await inlineStyles(html, htmlPath);
    html = html.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_match, open, css, close) => `${open}${minifyCss(css)}${close}`,
    );
    await fs.writeFile(htmlPath, minifyHtml(html), "utf8");
  }
  await fs.rm(assetsRoot, { recursive: true, force: true });
}

await inlineBuild();

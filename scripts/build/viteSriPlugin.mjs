import { createHash } from "node:crypto";
import path from "node:path";
import MagicString from "magic-string";

const SRI_ALGORITHM = "sha384";
const HMR_CLIENT_PATH = "/__napt_sri_hmr_client.js";
const HMR_HASH_PATH = "/__napt_sri_hmr_hash";
const HMR_PROBE_PATH = "/__napt_sri_hmr_probe.js";

export function integrityForSource(source) {
  return `${SRI_ALGORITHM}-${createHash(SRI_ALGORITHM)
    .update(Buffer.isBuffer(source) ? source : String(source))
    .digest("base64")}`;
}

function codeAsServedByVite(transformResult, requestUrl) {
  let { code } = transformResult;
  const map = transformResult.map;
  if (map && "version" in map && map.mappings) {
    code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`;
  } else if ((!map || map.mappings !== "") && !/sourceMappingURL\s*=/.test(code)) {
    const urlWithoutTimestamp = requestUrl.replace(/([?&])t=\d+&?/, "$1").replace(/[?&]$/, "");
    const generatedMap = new MagicString(code).generateMap({
      source: path.basename(urlWithoutTimestamp),
      hires: "boundary",
      includeContent: true,
    });
    code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(generatedMap)).toString("base64")}`;
  }
  return code;
}

function fileUrl(fileName, base) {
  const cleanBase = base || "/";
  if (cleanBase === "./" || cleanBase === "") return `./${fileName}`;
  return `${cleanBase.replace(/\/$/, "")}/${fileName}`;
}

function bundleIntegrityMap(bundle, base) {
  return Object.fromEntries(
    Object.entries(bundle)
      .filter(([fileName, item]) =>
        item.type === "chunk" && /\.m?js$/i.test(fileName),
      )
      .map(([fileName, item]) => [
        fileUrl(fileName, base),
        integrityForSource(item.code),
      ]),
  );
}

function outputUrlMatchesBundle(url, fileName, base) {
  const cleanUrl = url.split(/[?#]/, 1)[0];
  const candidates = [
    fileUrl(fileName, base),
    `/${fileName}`,
    `./${fileName}`,
    fileName,
  ];
  return candidates.includes(cleanUrl);
}

function withSriAttribute(tag, attribute, integrity) {
  const withoutOldSri = tag
    .replace(/\s+integrity=(?:"[^"]*"|'[^']*')/i, "")
    .replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?/i, "");
  const close = withoutOldSri.endsWith("/>") ? "/>" : ">";
  return `${withoutOldSri.slice(0, -close.length)} integrity="${integrity}" crossorigin="anonymous"${close}`;
}

function addSriAttributes(html, bundle, base) {
  return html.replace(/<(script|link)\b[^>]*>/gi, (tag) => {
    const isScript = /^<script\b/i.test(tag);
    const isModulePreload =
      /^<link\b/i.test(tag) && /\brel\s*=\s*["']modulepreload["']/i.test(tag);
    if (!isScript && !isModulePreload) return tag;

    const urlAttribute = isScript ? "src" : "href";
    const urlMatch = tag.match(new RegExp(`\\b${urlAttribute}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    if (!urlMatch) return tag;
    const entry = Object.entries(bundle).find(([fileName, item]) =>
      item.type === "chunk" &&
      /\.m?js$/i.test(fileName) &&
      outputUrlMatchesBundle(urlMatch[2], fileName, base),
    );
    if (!entry) return tag;
    return withSriAttribute(tag, urlAttribute, integrityForSource(entry[1].code));
  });
}

export function renderSriHtml(html, bundle, base = "/") {
  const integrity = bundleIntegrityMap(bundle, base);
  if (Object.keys(integrity).length === 0) return html;
  const withAttributes = addSriAttributes(html, bundle, base);
  const importMap = `<script type="importmap">${JSON.stringify({ integrity })}</script>`;
  const head = /<head\b[^>]*>/i;
  if (head.test(withAttributes)) {
    return withAttributes.replace(head, (openingTag) => `${openingTag}${importMap}`);
  }
  return `${importMap}${withAttributes}`;
}

function hmrClientSource(base) {
  return `
import { createHotContext } from "/@vite/client";
const viteBase = ${JSON.stringify(base || "/")};
const sriHashPath = ${JSON.stringify(HMR_HASH_PATH)};
const supportsImportMap = typeof HTMLScriptElement.supports === "function" && HTMLScriptElement.supports("importmap");
let importMapIntegritySupport;

function updatedModuleUrl(update) {
  const [path, query] = update.acceptedPath.split("?");
  const browserPath = path.startsWith(".") || path.startsWith("/") ? path : "/@id/" + encodeURIComponent(path);
  const url = viteBase + browserPath.slice(1) + "?" + (update.explicitImportRequired ? "import&" : "") + "t=" + update.timestamp + (query ? "&" + query : "");
  return new URL(url, location.href).href;
}

async function verifyImportMapIntegritySupport() {
  if (importMapIntegritySupport !== undefined) return importMapIntegritySupport;
  if (!supportsImportMap) return (importMapIntegritySupport = false);
  const probeUrl = new URL(${JSON.stringify(HMR_PROBE_PATH)}, location.href);
  probeUrl.searchParams.set("nonce", crypto.randomUUID());
  const probeResponse = await fetch(probeUrl, { cache: "no-store" });
  if (!probeResponse.ok) return (importMapIntegritySupport = false);
  const probeMap = document.createElement("script");
  probeMap.type = "importmap";
  probeMap.textContent = JSON.stringify({ integrity: { [probeUrl.href]: "sha384-" + "A".repeat(64) } });
  document.head.append(probeMap);
  try {
    await import(probeUrl.href);
    importMapIntegritySupport = false;
  } catch {
    importMapIntegritySupport = true;
  }
  return importMapIntegritySupport;
}

async function addIntegrityMapEntry(moduleUrl) {
  if (!await verifyImportMapIntegritySupport()) {
    throw new Error("This browser cannot enforce SRI for JavaScript module imports; hot update blocked");
  }
  const hashUrl = new URL(sriHashPath, location.href);
  hashUrl.searchParams.set("url", moduleUrl);
  const response = await fetch(hashUrl, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Vite SRI could not hash HMR module (" + response.status + ")");
  const result = await response.json();
  if (typeof result.integrity !== "string" || !/^sha384-[A-Za-z0-9+/]+=*$/.test(result.integrity)) {
    throw new Error("Vite SRI received an invalid HMR integrity value");
  }
  const importMap = document.createElement("script");
  importMap.type = "importmap";
  importMap.textContent = JSON.stringify({ integrity: { [moduleUrl]: result.integrity } });
  document.head.append(importMap);
}

const hot = createHotContext(${JSON.stringify(HMR_CLIENT_PATH)});
hot.on("vite:beforeUpdate", async ({ updates }) => {
  try {
    const jsUpdates = updates.filter((update) => update.type === "js-update");
    await Promise.all(jsUpdates.map((update) => addIntegrityMapEntry(updatedModuleUrl(update))));
  } catch (error) {
    console.error("[vite] SRI rejected a hot update; update blocked.", error);
    await new Promise(() => {});
  }
});
`;
}

async function devSriHtml(html, server, base) {
  const integrity = new Map();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)];
  await Promise.all(scripts.map(async ([, , rawUrl]) => {
    const parsedUrl = new URL(rawUrl, "http://vite.internal");
    if (parsedUrl.origin !== "http://vite.internal") return;
    const moduleUrl = `${parsedUrl.pathname}${parsedUrl.search}`;
    const transformed = await server.transformRequest(moduleUrl);
    if (!transformed) return;
    integrity.set(moduleUrl, integrityForSource(codeAsServedByVite(transformed, moduleUrl)));
  }));

  const withAttributes = html.replace(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi, (tag, _quote, rawUrl) => {
    const url = new URL(rawUrl, "http://vite.internal");
    const key = `${url.pathname}${url.search}`;
    const hash = integrity.get(key);
    return hash ? withSriAttribute(tag, "src", hash) : tag;
  });

  const hmrClientUrl = `${base.replace(/\/$/, "")}${HMR_CLIENT_PATH}`;
  const hmrIntegrity = integrityForSource(hmrClientSource(base));
  const hmrTag = `<script type="module" src="${hmrClientUrl}" integrity="${hmrIntegrity}" crossorigin="anonymous"></script>`;
  const head = /<head\b[^>]*>/i;
  if (head.test(withAttributes)) {
    return withAttributes.replace(head, (openingTag) => `${openingTag}${hmrTag}`);
  }
  return `${hmrTag}${withAttributes}`;
}

function parseSameOriginModuleUrl(rawUrl, request) {
  let requestOrigin;
  try {
    if (typeof request.headers.host !== "string") return null;
    requestOrigin = new URL(`${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`);
    const requested = new URL(rawUrl, requestOrigin);
    if (requested.origin !== requestOrigin.origin || requested.pathname.startsWith("//")) return null;
    return `${requested.pathname}${requested.search}`;
  } catch {
    return null;
  }
}

export function viteSriPlugin() {
  let command = "serve";
  let base = "/";

  return {
    name: "n-apt-vite-sri",
    configResolved(config) {
      command = config.command;
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      async handler(html, context) {
        if (command !== "serve") return;
        return await devSriHtml(html, context.server, base);
      },
    },
    generateBundle(_options, bundle) {
      if (command !== "build") return;
      for (const output of Object.values(bundle)) {
        if (output.type === "asset" && output.fileName.endsWith(".html")) {
          output.source = renderSriHtml(String(output.source), bundle, base);
        }
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || "/", "http://vite.internal").pathname;
        if (pathname === HMR_PROBE_PATH) {
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end("export const sriProbe = true;");
          return;
        }
        if (pathname === HMR_CLIENT_PATH) {
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(hmrClientSource(base));
          return;
        }
        if (pathname !== HMR_HASH_PATH) return next();
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.end();
          return;
        }
        const params = new URL(request.url || "/", "http://vite.internal").searchParams;
        const moduleUrl = parseSameOriginModuleUrl(params.get("url") || "", request);
        if (!moduleUrl || moduleUrl === HMR_CLIENT_PATH || moduleUrl === HMR_HASH_PATH) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid HMR module URL" }));
          return;
        }
        try {
          const transformed = await server.transformRequest(moduleUrl);
          if (!transformed) {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: "HMR module not found" }));
            return;
          }
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ integrity: integrityForSource(codeAsServedByVite(transformed, moduleUrl)) }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "HMR hashing failed" }));
        }
      });
    },
  };
}

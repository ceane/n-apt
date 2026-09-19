import React from "react";
import { render, waitFor } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import path from "node:path";

const buildOptions = {
  entryPoints: [path.resolve(process.cwd(), "src/app-article/App.tsx")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["react", "react-dom", "react/jsx-runtime", "styled-components"],
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl" },
  define: { __DEV__: "true", "import.meta.hot": "undefined" },
};
const bundle = execFileSync(process.execPath, ["--input-type=module", "-e", `import { buildSync } from 'esbuild'; process.stdout.write(buildSync(${JSON.stringify(buildOptions)}).outputFiles[0].text);`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const loaded = { exports: {} as { default: React.ComponentType } };
const load = (id: string) => {
  const dependency = require(id);
  return id === "styled-components" ? Object.assign(dependency.default, dependency) : dependency;
};
new Function("require", "module", "exports", bundle)(load, loaded, loaded.exports);
const App = loaded.exports.default;

it("sanitizes raw HTML through the actual article Markdown pipeline", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "text/plain" }),
    text: async () => [
      '<h2 id="theory-1">Theory 1</h2>',
      '<iframe title="unsupported"></iframe>',
      '<div style="position:fixed" data-unapproved="value">Article text</div>',
    ].join("\n\n"),
  });
  try {
    const { container } = render(<App />);
    await waitFor(() => expect(container.textContent).toContain("Article text"));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[data-unapproved]")).toBeNull();
    expect(container.querySelector("div[style*='fixed']")).toBeNull();
    expect(container.querySelector<HTMLElement>("h2#theory-1")).not.toBeNull();
    expect(container.querySelector('h2#user-content-theory-1')).toBeNull();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

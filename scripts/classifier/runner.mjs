import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/** A loopback-only ephemeral harness. No app server, uploads, or network model runtime. */
export async function createRunner() {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./browser.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'NativeClassifier', loader: { '.wgsl': 'text' } });
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu'] });
    const page = await browser.newPage();
    page.on("pageerror", error => console.error("GPU runner:", error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => { window.classifier = await NativeClassifier.initialize(); });
    return {
      extract: (spectrum, metadata, model) => page.evaluate(({ spectrum, metadata, model }) => window.classifier.extract(spectrum, metadata, model), { spectrum: Array.from(spectrum), metadata, model }),
      parity: () => page.evaluate(() => window.classifier.parity()),
      close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); },
    };
  } catch (error) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}

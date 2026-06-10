#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const katex = require('katex');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, cb) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(full, cb);
    } else if (ent.isFile()) {
      cb(full);
    }
  }
}

function extractStrings(content) {
  const results = [];
  // match const NAME = String.raw`...` or const NAME = `...` or const NAME = "..." or '...'
  const re = /const\s+([A-Za-z0-9_]+)\s*=\s*(?:String\.raw)?(`([\s\S]*?)`|"(([\\\s\S]*?))"|'(([\\\s\S]*?))')/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    let val = null;
    if (m[3] !== undefined) {
      // backtick content
      val = m[3];
    } else if (m[4] !== undefined) {
      // double-quoted, need unescape
      try {
        val = JSON.parse(`"${m[4].replace(/"/g, '\\"')}"`);
      } catch (e) {
        val = m[4];
      }
    } else if (m[6] !== undefined) {
      try {
        // single quoted -> convert to double-quoted for JSON.parse
        const s = m[6].replace(/\\'/g, "'").replace(/"/g, '\\"');
        val = JSON.parse(`"${s}"`);
      } catch (e) {
        val = m[6];
      }
    }
    if (val !== null) results.push({ name, val });
  }
  return results;
}

function sanitize(s) {
  return s.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
}

const files = [];
walk(SRC, (file) => {
  if (/\.(ts|tsx|js|jsx)$/.test(file)) files.push(file);
});

const errors = [];
const warnings = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  const found = extractStrings(content);
  if (!found.length) continue;
  for (const { name, val } of found) {
    if (!val || val.length < 2) continue;
    // only consider strings with backslashes (likely LaTeX)
    if (!/[\\]\\w|\\\\/.test(val) && !val.includes('\\')) continue;
    const s = sanitize(val);
    try {
      const html = katex.renderToString(s, { throwOnError: false, displayMode: true, strict: 'warn' });

      // If katex produced an error element, flag it as an error
      if (html.includes('katex-error')) {
        errors.push({ file: rel, name, error: 'KaTeX render produced an error element', raw: s.slice(0, 500) });
        continue;
      }

      // Remove MathML <annotation> (contains original TeX) and <math> blocks before checking
      const withoutAnnotations = html.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
      const withoutMathML = withoutAnnotations.replace(/<math[\s\S]*?<\/math>/g, '');

      // detect visible backslash sequences remaining in the rendered HTML
      const visibleBackslash = /\\\\?[A-Za-z]{1,12}/.test(withoutMathML);
      if (visibleBackslash) {
        warnings.push({ file: rel, name, reason: 'Rendered HTML contains visible backslash sequences (likely unparsed TeX)', sample: withoutMathML.slice(0, 300) });
      }
    } catch (err) {
      errors.push({ file: rel, name, error: String(err), raw: s.slice(0, 500) });
    }
    // Also check for suspicious control characters or accents in the raw string
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i);
      if (!cp) continue;
      if (cp === 0xfeff || (cp >= 0x200b && cp <= 0x200d)) {
        warnings.push({ file: rel, name, reason: `Contains zero-width character U+${cp.toString(16)}` });
      }
    }
  }
}

if (warnings.length) {
  console.warn('[katex-lint] Warnings:');
  for (const w of warnings) console.warn(' -', w.file, w.name, '-', w.reason, w.sample ? `sample: ${w.sample}` : '');
}

if (errors.length) {
  console.error('[katex-lint] Errors:');
  for (const e of errors) console.error(' -', e.file, e.name, '-', e.error, `raw: ${e.raw}`);
  process.exitCode = 2;
} else if (warnings.length) {
  process.exitCode = 1;
} else {
  console.log('[katex-lint] OK — no issues found');
}

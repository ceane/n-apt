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
        const s = m[4].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        val = JSON.parse(`"${s}"`);
      } catch (e) {
        val = m[4];
      }
    } else if (m[6] !== undefined) {
      try {
        // single quoted -> convert to double-quoted for JSON.parse
        const s = m[6].replace(/\\/g, '\\\\').replace(/\\'/g, "'").replace(/"/g, '\\"');
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
    // If the source string contains combining diacritics or zero-widths, flag immediately
    for (let i = 0; i < val.length; i++) {
      const cp = val.codePointAt(i);
      if (!cp) continue;
      if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200d) || cp === 0xfeff) {
        warnings.push({ file: rel, name, reason: `Source string contains suspicious codepoint U+${cp.toString(16)}` });
        break;
      }
    }
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

      // Detect suspicious combining diacritics or zero-width characters that
      // would cause KaTeX to split macros into backslash + following combining
      // char sequences. We look for common combining accents in the BMP (U+0300–U+036F)
      // and common zero-widths (U+200B..U+200D, U+FEFF).
      const rawCodepoints = Array.from(s).map((c) => c.codePointAt(0));
      for (let i = 0; i < rawCodepoints.length; i++) {
        const cp = rawCodepoints[i];
        if (!cp) continue;
        if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200d) || cp === 0xfeff) {
          warnings.push({ file: rel, name, reason: `Contains suspicious codepoint U+${cp.toString(16)}` });
          break;
        }
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

// Additional repository-wide scan: find any occurrences of suspicious
// combining diacritics or zero-width characters outside of the simple const
// string extraction. This helps catch strings embedded in JSX, template
// expressions, or generated assets that the earlier extractor may miss.
const suspiciousRe = /[\u0300-\u036F\u00B8\u02DA\u200B-\u200D\uFEFF]/g;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = suspiciousRe.exec(content)) !== null) {
    // compute line number
    const upto = content.slice(0, m.index);
    const line = upto.split('\n').length;
    const snippet = content.slice(Math.max(0, m.index - 40), Math.min(content.length, m.index + 40)).replace(/\n/g, ' ');
    warnings.push({ file: rel, name: `suspicious-char-line-${line}`, reason: `Suspicious character U+${m[0].codePointAt(0).toString(16)}`, sample: `line ${line}: ...${snippet}...` });
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

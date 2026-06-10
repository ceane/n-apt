export function sanitizeLatex(input: string): string {
  if (!input) return input;
  // Remove Unicode format characters (Cf) and combining marks (M)
  // These can appear invisibly and break KaTeX macro parsing (e.g. turn \cdot into \c + dot)
  try {
    // Use Unicode property escapes to strip format and mark characters
    return input.replace(/\p{Cf}|\p{M}/gu, '');
  } catch (e) {
    // Fallback: remove common problematic codepoints and known combining ranges
    // if Unicode property escapes are not supported in the runtime RegExp engine.
    return input.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g, '');
  }
}

// Development-only helper that logs removed characters and codepoints.
export function sanitizeLatexWithDebug(label: string, input: string): string {
  if (!input) return input;
  const before = input;
  const after = sanitizeLatex(input);
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.debug(`[katex-sanitize] ${label} before len=${before.length} after len=${after.length}`, {
      beforeCodepoints: Array.from(before).map((c) => c.codePointAt(0)?.toString(16).padStart(4, '0')).join(' '),
      afterCodepoints: Array.from(after).map((c) => c.codePointAt(0)?.toString(16).padStart(4, '0')).join(' '),
      before,
      after,
    });
  }
  return after;
}

// Development helper: logs removed codepoints when sanitizer changed the string.
// Kept here for the linter and any targeted debug usage, but not imported by components.
// Development helper removed — prefer static linter to detect invisible/combining
// characters and fix them at the source (encrypted module pipeline).
// If you need the debugging helper temporarily, reintroduce a targeted
// sanitizeLatexWithDebug that logs only in development.

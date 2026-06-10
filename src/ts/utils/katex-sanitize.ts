export function sanitizeLatex(input: string): string {
  if (!input) return input;
  // Remove Unicode format characters (Cf) and combining marks (M)
  // These can appear invisibly and break KaTeX macro parsing (e.g. turn \cdot into \c + dot)
  try {
    // Use Unicode property escapes to strip format and mark characters
    return input.replace(/\p{Cf}|\p{M}/gu, '');
  } catch (e) {
    // Fallback: remove common problematic codepoints if Unicode property escapes not supported
    return input.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  }
}

export function sanitizeLatexWithDebug(label: string, input: string): string {
  const before = input;
  const after = sanitizeLatex(input);
  if (process.env.NODE_ENV === 'development' && before !== after) {
    // eslint-disable-next-line no-console
    console.debug(`[katex-sanitize] ${label}: removed characters`, {
      beforeCodepoints: Array.from(before).map((c) => c.codePointAt(0)?.toString(16).padStart(4, '0')).join(' '),
      afterCodepoints: Array.from(after).map((c) => c.codePointAt(0)?.toString(16).padStart(4, '0')).join(' '),
      before,
      after,
    });
  }
  return after;
}

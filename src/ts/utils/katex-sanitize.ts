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

// Development helper: logs removed codepoints when sanitizer changed the string.
// Kept here for the linter and any targeted debug usage, but not imported by components.
// Development helper removed — prefer static linter to detect invisible/combining
// characters and fix them at the source (encrypted module pipeline).
// If you need the debugging helper temporarily, reintroduce a targeted
// sanitizeLatexWithDebug that logs only in development.

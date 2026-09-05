import DOMPurify from "dompurify";

/**
 * Sanitizes a whole SVG string, ensuring standard SVG and SMIL animation elements are preserved.
 */
export function sanitizeSVG(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: [
      "animate",
      "animateMotion",
      "animateTransform",
      "mpath",
      "set",
      "symbol",
      "use",
    ],
    ADD_ATTR: [
      "attributeName",
      "values",
      "dur",
      "repeatCount",
      "begin",
      "from",
      "to",
      "keyTimes",
      "keySplines",
      "calcMode",
      "preserveAspectRatio",
      "opacity",
    ],
    ALLOWED_URI_REGEXP: /^(?:#|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
    RETURN_TRUSTED_TYPE: false,
  });
}

/**
 * Escapes a value for use in an HTML/SVG attribute.
 * Fast way to ensure individual attributes don't break out of their quotes.
 */
export function escapeAttr(val: string | number): string {
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strict sanitizer for numeric attributes (width, height, coords, durations).
 */
export function sanitizeNumeric(val: string | number): string {
  const s = String(val);
  // Allow numbers, decimals, units (px, %, em, rem, s, ms)
  return s.replace(/[^\d.a-z%-]/gi, "");
}

/**
 * Sanitizer for SVG path data.
 */
export function sanitizePath(val: string): string {
  // Allow M, L, H, V, C, S, Q, T, A, Z, numbers, commas, spaces, dots, dashes
  return val.replace(/[^\d. ,MLHVCSQTAZz-]/gi, "");
}

/**
 * Sanitizer for viewBox.
 */
export function sanitizeViewBox(val: string): string {
  // Allow numbers, decimals, and spaces
  return val.replace(/[^\d. ]/g, "");
}

/**
 * Asset URL helper utility.
 * Handles switching between /md-preview/ in dev and / in production (docs/).
 */

export const getBaseUrl = () => {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
};

/**
 * Resolves a generic asset path by ensuring it follows the current site base URL.
 * Primarily used for paths coming from Markdown.
 */
export const assetUrl = (path: string): string => {
  if (!path || path.startsWith("http") || path.startsWith("data:")) return path;

  const baseUrl = getBaseUrl();
  
  // Strip environment-specific prefix if hardcoded, then ensure it's root-relative
  let cleaned = path.replace(/^\/md-preview\//, "/");
  if (!cleaned.startsWith("/")) cleaned = `/${cleaned}`;

  return `${baseUrl}${cleaned.slice(1)}`;
};

/**
 * Resolves an image filename to its full path: {base}/images/{filename}
 */
export const assetImageUrl = (filename: string): string => {
  if (!filename) return "";
  const cleanFile = filename.replace(/^\/+(images\/)?/g, "");
  return `${getBaseUrl()}images/${cleanFile}`;
};

/**
 * Resolves a markdown page filename to its full path: {base}/pages/{filename}
 */
export const assetPageUrl = (filename: string): string => {
  if (!filename) return "";
  const cleanFile = filename.replace(/^\/+(pages\/)?/g, "");
  return `${getBaseUrl()}pages/${cleanFile}`;
};

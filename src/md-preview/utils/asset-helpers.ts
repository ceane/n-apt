/**
 * Asset URL helper utility.
 * Handles switching between /md-preview/ in dev and / in production (docs/).
 */

let memoizedBase: string | null = null;

// Declare the global variable that will be injected by Vite or Jest
declare global {
  var __APP_BASE_URL__: string | undefined;
  var __DEV__: boolean | undefined;
}

/**
 * Returns the current base URL. 
 * Supports fallback for Jest/Node environments via __APP_BASE_URL__ global.
 */
export const getBaseUrl = (): string => {
  if (memoizedBase) return memoizedBase;

  // Use the global variable which is replaced by Vite or set in Jest setup
  const base = (typeof __APP_BASE_URL__ !== 'undefined' ? __APP_BASE_URL__ : "/") || "/";

  const finalBase = base.endsWith("/") ? base : `${base}/`;
  
  // Only memoize if we are NOT in a test environment
  if (typeof jest === 'undefined') {
    memoizedBase = finalBase;
  }
  return finalBase;
};

/**
 * Internal helper to override base URL for testing purposes.
 */
export const _setBaseUrl = (base: string | null) => {
  memoizedBase = base;
};

/**
 * Resolves a generic asset path by ensuring it follows the current site base URL.
 * Primarily used for paths coming from Markdown.
 */
export const assetUrl = (path: string): string => {
  if (!path || path.startsWith("http") || path.startsWith("data:")) return path;

  const baseUrl = getBaseUrl();
  
  // Clean the path: remove any existing /md-preview/ or the current baseUrl prefix
  // to avoid double-prefixing when switching between dev/prod or re-processing paths.
  let cleaned = path.replace(/^\/md-preview\//, "/");
  if (baseUrl !== "/" && cleaned.startsWith(baseUrl)) {
    // If baseUrl is /n-apt/ and path is /n-apt/img.png, we want /img.png first
    if (cleaned.startsWith(baseUrl)) {
        cleaned = cleaned.slice(baseUrl.length - 1);
    }
  }
  
  if (!cleaned.startsWith("/")) cleaned = `/${cleaned}`;

  return `${baseUrl}${cleaned.slice(1)}`;
};

/**
 * Resolves an image filename to its full path: {base}images/{filename}
 */
export const assetImageUrl = (filename: string): string => {
  if (!filename) return "";
  const cleanFile = filename.replace(/^(\/+)?(images\/)?/g, "");
  return `${getBaseUrl()}images/${cleanFile}`;
};

/**
 * Resolves a markdown page filename to its full path: {base}pages/{filename}
 */
export const assetPageUrl = (filename: string): string => {
  if (!filename) return "";
  const cleanFile = filename.replace(/^(\/+)?(pages\/)?/g, "");
  return `${getBaseUrl()}pages/${cleanFile}`;
};
